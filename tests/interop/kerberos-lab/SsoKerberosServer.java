import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.PrivilegedExceptionAction;
import java.security.SecureRandom;
import java.security.KeyStore;
import java.util.Base64;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import javax.security.auth.Subject;
import javax.security.auth.login.AppConfigurationEntry;
import javax.security.auth.login.Configuration;
import javax.security.auth.login.LoginContext;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import org.ietf.jgss.GSSContext;
import org.ietf.jgss.GSSCredential;
import org.ietf.jgss.GSSManager;
import org.ietf.jgss.Oid;

public final class SsoKerberosServer {
    private static final String COOKIE = "sso_lab";
    private final Subject serviceSubject;
    private final Set<String> sessions = new HashSet<>();
    private final SecureRandom random = new SecureRandom();
    private final Path sdkDirectory;
    private final boolean secureCookie;

    private SsoKerberosServer(String principal, String keytab, String sdkDirectory, boolean secureCookie) throws Exception {
        this.sdkDirectory = Path.of(sdkDirectory);
        this.secureCookie = secureCookie;
        Configuration config = new Configuration() {
            @Override public AppConfigurationEntry[] getAppConfigurationEntry(String name) {
                return new AppConfigurationEntry[] {new AppConfigurationEntry(
                    "com.sun.security.auth.module.Krb5LoginModule",
                    AppConfigurationEntry.LoginModuleControlFlag.REQUIRED,
                    Map.of("useKeyTab", "true", "keyTab", keytab, "principal", principal,
                           "storeKey", "true", "doNotPrompt", "true", "isInitiator", "false")
                )};
            }
        };
        LoginContext login = new LoginContext("sso-lab", null, null, config);
        login.login();
        serviceSubject = login.getSubject();
    }

    private void handle(HttpExchange exchange) throws Exception {
        String path = exchange.getRequestURI().getPath();
        if (path.equals("/")) {
            System.out.println("page-root");
            respond(exchange, 200, """
                <!doctype html><html><head><meta charset="utf-8"><title>SSO Kerberos lab</title></head>
                <body><p id="status">starting</p><script type="module">
                import { createSSO } from '/sdk/index.js';
                import { negotiateAdapter } from '/sdk/negotiate.js';
                const client = createSSO({
                  session: { endpoint: '/sso/session' },
                  adapter: negotiateAdapter({ loginEndpoint: '/sso/negotiate/start' }),
                  logout: { endpoint: '/sso/logout' },
                });
                try {
                  const state = await client.ensureAuthenticated();
                  document.getElementById('status').textContent = state.status;
                  if (state.status === 'authenticated') {
                    await fetch('/sdk-observation?status=authenticated', { cache: 'no-store' });
                    if (new URL(location.href).searchParams.has('exerciseLogout')) {
                      await client.logout();
                      const after = await client.getSession();
                      if (client.getState().status === 'unauthenticated' &&
                          after.status === 'unauthenticated') {
                        await fetch('/sdk-observation?status=logged-out', { cache: 'no-store' });
                      }
                    }
                  }
                } catch {
                  document.getElementById('status').textContent = 'error';
                }
                </script></body></html>
                """, "text/html; charset=utf-8");
            return;
        }
        if (path.equals("/sdk/index.js") || path.equals("/sdk/negotiate.js") || path.equals("/sdk/redirect.js")) {
            String file = path.substring("/sdk/".length());
            System.out.println("sdk-module " + file);
            respond(exchange, 200, Files.readString(sdkDirectory.resolve(file)), "text/javascript; charset=utf-8");
            return;
        }
        if (path.equals("/sdk-observation")) {
            if ("status=authenticated".equals(exchange.getRequestURI().getRawQuery())) {
                System.out.println("sdk-observation authenticated");
            } else if ("status=logged-out".equals(exchange.getRequestURI().getRawQuery())
                && !hasSession(exchange)) {
                System.out.println("sdk-observation logged-out");
            }
            respond(exchange, 204, "", "text/plain; charset=utf-8");
            return;
        }
        if (path.equals("/sso/session")) {
            boolean valid = hasSession(exchange);
            System.out.println("session authenticated=" + valid);
            respond(exchange, 200, valid
                ? "{\"authenticated\":true,\"user\":{\"id\":\"testuser\"}}"
                : "{\"authenticated\":false}");
            return;
        }
        if (path.equals("/sso/logout")) {
            if (!exchange.getRequestMethod().equals("POST")) {
                exchange.getResponseHeaders().set("Allow", "POST");
                respond(exchange, 405, "method-not-allowed");
                return;
            }
            String cookie = exchange.getRequestHeaders().getFirst("Cookie");
            if (cookie != null) sessions.removeIf(value -> cookie.contains(COOKIE + "=" + value));
            exchange.getResponseHeaders().set("Set-Cookie", COOKIE + "=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax" + (secureCookie ? "; Secure" : ""));
            respond(exchange, 200, "logged-out");
            return;
        }
        if (!path.equals("/sso/negotiate/start")) {
            respond(exchange, 404, "not-found");
            return;
        }
        String returnTo = returnTo(exchange);
        if (returnTo == null) {
            respond(exchange, 400, "invalid-return-to");
            return;
        }
        String auth = exchange.getRequestHeaders().getFirst("Authorization");
        if (auth == null || !auth.startsWith("Negotiate ")) {
            System.out.println("challenge");
            exchange.getResponseHeaders().set("WWW-Authenticate", "Negotiate");
            respond(exchange, 401, "challenge");
            return;
        }
        try {
            byte[] incoming = Base64.getDecoder().decode(auth.substring(10));
            Result result = Subject.doAs(serviceSubject, (PrivilegedExceptionAction<Result>) () -> {
                GSSManager manager = GSSManager.getInstance();
                GSSCredential credential = manager.createCredential(null, GSSCredential.DEFAULT_LIFETIME,
                    new Oid("1.3.6.1.5.5.2"), GSSCredential.ACCEPT_ONLY);
                GSSContext context = manager.createContext(credential);
                byte[] outgoing = context.acceptSecContext(incoming, 0, incoming.length);
                if (!context.isEstablished()) return new Result(null, null, outgoing);
                return new Result(context.getSrcName().toString(), context.getMech().toString(), outgoing);
            });
            if (result.outgoing != null && result.outgoing.length > 0) {
                exchange.getResponseHeaders().set("WWW-Authenticate", "Negotiate " + Base64.getEncoder().encodeToString(result.outgoing));
            }
            if (result.identity == null) {
                respond(exchange, 401, "continue");
                return;
            }
            if (!result.mechanism.equals("1.2.840.113554.1.2.2")) {
                System.out.println("rejected mechanism=" + result.mechanism);
                respond(exchange, 403, "unsupported-mechanism");
                return;
            }
            byte[] nonce = new byte[24];
            random.nextBytes(nonce);
            String session = Base64.getUrlEncoder().withoutPadding().encodeToString(nonce);
            sessions.add(session);
            exchange.getResponseHeaders().set("Set-Cookie", COOKIE + "=" + session + "; HttpOnly; Path=/; SameSite=Lax" + (secureCookie ? "; Secure" : ""));
            exchange.getResponseHeaders().set("Location", returnTo);
            System.out.println("accepted mechanism=" + result.mechanism + " identity=" + result.identity);
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        } catch (Exception error) {
            System.out.println("rejected authentication=" + error.getClass().getSimpleName());
            respond(exchange, 401, "authentication-failed");
        }
    }

    private static void respond(HttpExchange exchange, int status, String body) throws Exception {
        respond(exchange, status, body, "application/json; charset=utf-8");
    }

    private boolean hasSession(HttpExchange exchange) {
        String cookie = exchange.getRequestHeaders().getFirst("Cookie");
        return cookie != null && sessions.stream().anyMatch(value -> cookie.contains(COOKIE + "=" + value));
    }

    private static String returnTo(HttpExchange exchange) {
        String query = exchange.getRequestURI().getRawQuery();
        if (query == null) return "/";
        String target = null;
        try {
            for (String part : query.split("&")) {
                String[] pair = part.split("=", 2);
                if (!URLDecoder.decode(pair[0], StandardCharsets.UTF_8).equals("returnTo")) continue;
                if (target != null) return null;
                target = URLDecoder.decode(pair.length == 2 ? pair[1] : "", StandardCharsets.UTF_8);
            }
            if (target == null) return "/";
            if (!target.startsWith("/") || target.startsWith("//") || target.indexOf('\\') >= 0) return null;
            URI path = URI.create(target);
            if (path.isAbsolute() || path.getRawAuthority() != null || path.getRawFragment() != null
                || !path.normalize().getPath().equals(path.getPath())) return null;
            return target;
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    private static void respond(HttpExchange exchange, int status, String body, String contentType) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(status, status == 204 ? -1 : bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private record Result(String identity, String mechanism, byte[] outgoing) {}

    public static void main(String[] args) throws Exception {
        boolean tls = args.length == 6;
        SsoKerberosServer app = new SsoKerberosServer(args[1], args[2], args[3], tls);
        InetSocketAddress address = new InetSocketAddress("127.0.0.1", Integer.parseInt(args[0]));
        HttpServer server;
        if (tls) {
            KeyStore keys = KeyStore.getInstance("PKCS12");
            char[] password = args[5].toCharArray();
            try (InputStream input = Files.newInputStream(Path.of(args[4]))) {
                keys.load(input, password);
            }
            KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            managers.init(keys, password);
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(managers.getKeyManagers(), null, null);
            HttpsServer https = HttpsServer.create(address, 0);
            https.setHttpsConfigurator(new HttpsConfigurator(context));
            server = https;
        } else {
            server = HttpServer.create(address, 0);
        }
        server.createContext("/", exchange -> {
            try { app.handle(exchange); }
            catch (Exception error) { error.printStackTrace(); exchange.close(); }
        });
        server.start();
        System.out.println("ready port=" + args[0]);
    }
}
