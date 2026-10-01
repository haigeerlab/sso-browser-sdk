"""Opt-in, loopback-only Kerberos HTTP Negotiate interoperability check."""

import base64
import http.client
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread


HERE = Path(__file__).resolve().parent
REALM = "SSO.TEST"
KERBEROS_OID = "1.2.840.113554.1.2.2"


def command(name, directory=None):
    if directory:
        candidate = directory / name
        if candidate.is_file():
            return str(candidate)
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f"Missing {name}; see README.md")
    return found


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def invoke(args, env=None):
    subprocess.run(args, env=env, check=True, capture_output=True, text=True)


def request(port, path, cookie=None, authorization=None, method="GET"):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {}
    if cookie:
        headers["Cookie"] = cookie
    if authorization:
        headers["Authorization"] = authorization
    connection.request(method, path, headers=headers)
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), response.read().decode()
    connection.close()
    return result


def wait_for_server(process, port, name):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{name} exited before listening")
        with socket.socket() as probe:
            probe.settimeout(0.1)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.1)
    raise RuntimeError(f"{name} did not listen on loopback")


def negotiate(curl, env, host, port, jar, certificate=None):
    tls = ["--cacert", str(certificate)] if certificate else []
    scheme = "https" if certificate else "http"
    result = subprocess.run(
        [curl, "--silent", "--show-error", "--negotiate", "-u", ":",
         "--noproxy", "*", "--resolve", f"{host}:{port}:127.0.0.1",
         *tls,
         "--cookie-jar", str(jar), "--output", os.devnull,
         "--write-out", "%{http_code}",
         f"{scheme}://{host}:{port}/sso/negotiate/start?returnTo=%2F"],
        env=env, check=True, capture_output=True, text=True,
    )
    return int(result.stdout)


def session_cookie(jar):
    for line in jar.read_text().splitlines():
        if line.startswith("#HttpOnly_"):
            fields = line.split("\t")
            return f"{fields[5]}={fields[6]}"
    raise AssertionError("No HttpOnly session cookie issued")


def secure_cookie(jar):
    return any(line.startswith("#HttpOnly_") and line.split("\t")[3] == "TRUE"
               for line in jar.read_text().splitlines())


def tls_request(curl, env, host, port, certificate, path, cookie=None, method="GET"):
    args = [curl, "--silent", "--show-error", "--noproxy", "*", "--cacert", str(certificate),
            "--resolve", f"{host}:{port}:127.0.0.1"]
    if cookie:
        args += ["--cookie", cookie]
    if method != "GET":
        args += ["--request", method]
    args += [f"https://{host}:{port}{path}"]
    result = subprocess.run(args, env=env, check=True, capture_output=True, text=True)
    return result.stdout


@contextmanager
def altered_reverse_proxy(upstream_port, strip_header):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            authorization = self.headers.get("Authorization")
            if authorization:
                self.server.saw_authorization = True
            headers = {"Host": "app-a.localhost"}
            if authorization and strip_header != "Authorization":
                headers["Authorization"] = authorization
            upstream = http.client.HTTPConnection("127.0.0.1", upstream_port, timeout=5)
            try:
                upstream.request("GET", self.path, headers=headers)
                response = upstream.getresponse()
                body = response.read()
                self.send_response(response.status)
                for name, value in response.getheaders():
                    if name.lower() in {"connection", "content-length", "transfer-encoding"}:
                        continue
                    if name.lower() == "www-authenticate" and strip_header == "WWW-Authenticate":
                        continue
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            finally:
                upstream.close()

        def log_message(self, _format, *_args):
            pass

    proxy = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    proxy.saw_authorization = False
    thread = Thread(target=proxy.serve_forever, daemon=True)
    thread.start()
    try:
        yield proxy
    finally:
        proxy.shutdown()
        proxy.server_close()
        thread.join(timeout=5)


def check(condition, description):
    if not condition:
        raise AssertionError(description)


def stop_firefox(process):
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def probe_firefox(firefox, env, root, host, port, server_log):
    profile = root / "firefox-profile"
    profile.mkdir(exist_ok=True)
    (profile / "user.js").write_text(
        'user_pref("network.negotiate-auth.trusted-uris", "app-a.localhost,app-b.localhost");\n'
        'user_pref("network.negotiate-auth.allow-non-fqdn", true);\n'
        'user_pref("network.proxy.type", 0);\n'
    )
    before = server_log.read_text().count(f"accepted mechanism={KERBEROS_OID}")
    observed_before = server_log.read_text().count("sdk-observation authenticated")
    args = [firefox, "--new-instance", "--profile", str(profile), "--headless",
            f"http://{host}:{port}/"]
    process = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and process.poll() is None:
            content = server_log.read_text()
            if (content.count(f"accepted mechanism={KERBEROS_OID}") > before and
                    content.count("sdk-observation authenticated") > observed_before):
                return
            time.sleep(0.1)
    finally:
        stop_firefox(process)
    content = server_log.read_text()
    check(content.count(f"accepted mechanism={KERBEROS_OID}") > before,
          "Firefox did not complete Kerberos Negotiate; server events=" +
          ", ".join(content.splitlines()[-12:]))
    check(server_log.read_text().count("sdk-observation authenticated") > observed_before,
          "Browser SDK did not recover the authenticated session")


def probe_untrusted_firefox(firefox, env, root, host, port, server_log):
    profile = root / "firefox-untrusted-profile"
    profile.mkdir()
    (profile / "user.js").write_text(
        'user_pref("network.negotiate-auth.trusted-uris", "");\n'
        'user_pref("network.automatic-ntlm-auth.trusted-uris", "");\n'
        'user_pref("network.proxy.type", 0);\n'
    )
    initial_log = server_log.read_text()
    args = [firefox, "--new-instance", "--profile", str(profile), "--headless",
            f"http://{host}:{port}/"]
    process = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and process.poll() is None:
            if server_log.read_text().count("challenge\n") > initial_log.count("challenge\n"):
                time.sleep(2)
                break
            time.sleep(0.1)
    finally:
        stop_firefox(process)
    final_log = server_log.read_text()
    check(final_log.count("challenge\n") > initial_log.count("challenge\n"),
          "Untrusted Firefox did not reach the challenge")
    check(final_log.count(f"accepted mechanism={KERBEROS_OID}") ==
          initial_log.count(f"accepted mechanism={KERBEROS_OID}"),
          "Untrusted Firefox unexpectedly established a Kerberos session")
    check(final_log.count("sdk-observation authenticated") ==
          initial_log.count("sdk-observation authenticated"),
          "Untrusted Firefox unexpectedly observed an authenticated SDK session")


def webdriver_command(port, method, path, payload=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    body = json.dumps(payload) if payload is not None else None
    connection.request(method, path, body=body,
                       headers={"Content-Type": "application/json"} if body else {})
    response = connection.getresponse()
    result = json.loads(response.read())
    connection.close()
    if response.status >= 400:
        raise RuntimeError(f"WebDriver {method} {path} failed: {result['value'].get('error')}")
    return result["value"]


def probe_tls_firefox(firefox, geckodriver, env, root, hosts):
    driver_port = free_port()
    with (root / "geckodriver.log").open("w") as log:
        driver = subprocess.Popen([geckodriver, "--host", "127.0.0.1", "--port", str(driver_port)],
                                  env=env, stdout=log, stderr=subprocess.STDOUT,
                                  start_new_session=True)
        session = None
        try:
            wait_for_server(driver, driver_port, "geckodriver")
            session = webdriver_command(driver_port, "POST", "/session", {
                "capabilities": {"alwaysMatch": {
                    "browserName": "firefox", "acceptInsecureCerts": True,
                    "moz:firefoxOptions": {
                        "binary": firefox, "args": ["-headless"],
                        "prefs": {
                            "network.negotiate-auth.trusted-uris": "app-a.localhost,app-b.localhost",
                            "network.negotiate-auth.allow-non-fqdn": True,
                            "network.proxy.type": 0,
                        },
                    },
                }},
            })["sessionId"]
            for host, port, server_log in hosts:
                before = server_log.read_text()
                webdriver_command(driver_port, "POST", f"/session/{session}/url",
                                  {"url": f"https://{host}:{port}/"})
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    content = server_log.read_text()
                    if (content.count(f"accepted mechanism={KERBEROS_OID}") >
                            before.count(f"accepted mechanism={KERBEROS_OID}") and
                            content.count("sdk-observation authenticated") >
                            before.count("sdk-observation authenticated")):
                        break
                    time.sleep(0.1)
                else:
                    raise AssertionError(f"HTTPS Firefox SDK login failed on {host}; " +
                                         ", ".join(server_log.read_text().splitlines()[-12:]))
            a_host, a_port, a_log = hosts[0]
            b_host, b_port, b_log = hosts[1]
            before_a = a_log.read_text()
            webdriver_command(driver_port, "POST", f"/session/{session}/url",
                              {"url": f"https://{a_host}:{a_port}/?exerciseLogout=1"})
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if (a_log.read_text().count("sdk-observation logged-out") >
                        before_a.count("sdk-observation logged-out")):
                    break
                time.sleep(0.1)
            else:
                raise AssertionError("Firefox SDK POST logout did not clear A's session")
            before_b = b_log.read_text()
            webdriver_command(driver_port, "POST", f"/session/{session}/url",
                              {"url": f"https://{b_host}:{b_port}/"})
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if (b_log.read_text().count("sdk-observation authenticated") >
                        before_b.count("sdk-observation authenticated")):
                    break
                time.sleep(0.1)
            else:
                raise AssertionError("Firefox B session did not survive A SDK logout")
            check(b_log.read_text().count(f"accepted mechanism={KERBEROS_OID}") ==
                  before_b.count(f"accepted mechanism={KERBEROS_OID}"),
                  "B unexpectedly reauthenticated after A logout")
            before_a = a_log.read_text()
            webdriver_command(driver_port, "POST", f"/session/{session}/url",
                              {"url": f"https://{a_host}:{a_port}/"})
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                content = a_log.read_text()
                if (content.count(f"accepted mechanism={KERBEROS_OID}") >
                        before_a.count(f"accepted mechanism={KERBEROS_OID}") and
                        content.count("sdk-observation authenticated") >
                        before_a.count("sdk-observation authenticated")):
                    break
                time.sleep(0.1)
            else:
                raise AssertionError("Firefox A did not reauthenticate after local logout")
        finally:
            if session:
                try:
                    webdriver_command(driver_port, "DELETE", f"/session/{session}")
                except (OSError, RuntimeError):
                    pass
            stop_firefox(driver)


def run(root, programs):
    ports = set()
    while len(ports) < 6:
        ports.add(free_port())
    kdc_port, app_a, app_b, wrong_spn, tls_a, tls_b = ports
    krb5_config = root / "krb5.conf"
    krb5_config.write_text(f"""[libdefaults]
 default_realm = {REALM}
 dns_lookup_kdc = false
 dns_lookup_realm = false
 rdns = false
 dns_canonicalize_hostname = false
 udp_preference_limit = 1
[realms]
 {REALM} = {{
  kdc = 127.0.0.1:{kdc_port}
 }}
[domain_realm]
 .localhost = {REALM}
 localhost = {REALM}
""")
    kdc_config = root / "kdc.conf"
    kdc_config.write_text(f"""[kdcdefaults]
 kdc_ports = {kdc_port}
 kdc_tcp_ports = {kdc_port}
[realms]
 {REALM} = {{
  database_name = {root / 'principal'}
  key_stash_file = {root / 'stash'}
  acl_file = {root / 'acl'}
 }}
""")
    (root / "acl").write_text("")
    env = os.environ | {
        "KRB5_CONFIG": str(krb5_config),
        "KRB5_KDC_PROFILE": str(kdc_config),
        "KRB5CCNAME": f"FILE:{root / 'client.ccache'}",
    }
    invoke([programs["kdb5_util"], "-r", REALM, "-P", secrets.token_hex(32),
            "create", "-s"], env)
    for principal, keytab in (
        ("testuser", "client.keytab"),
        ("HTTP/app-a.localhost", "service.keytab"),
        ("HTTP/app-b.localhost", "service.keytab"),
    ):
        invoke([programs["kadmin.local"], "-q", f"addprinc -randkey {principal}"], env)
        invoke([programs["kadmin.local"], "-q", f"ktadd -k {root / keytab} {principal}"], env)
    for name in ("client.keytab", "service.keytab"):
        (root / name).chmod(0o600)
    classes = root / "classes"
    classes.mkdir()
    invoke([programs["javac"], "-d", str(classes), str(HERE / "SsoKerberosServer.java")])

    processes = []
    logs = []
    try:
        kdc_log = root / "kdc.log"
        logs.append(kdc_log.open("w"))
        kdc = subprocess.Popen([programs["krb5kdc"], "-n", "-r", REALM,
                                "-p", str(kdc_port)], env=env,
                               stdout=logs[-1], stderr=subprocess.STDOUT)
        processes.append(kdc)
        wait_for_server(kdc, kdc_port, "KDC")
        invoke([programs["kinit"], "-k", "-t", str(root / "client.keytab"),
                f"testuser@{REALM}"], env)
        invoke([programs["kvno"], f"HTTP/app-a.localhost@{REALM}",
                f"HTTP/app-b.localhost@{REALM}"], env)

        for name, port, principal in (
            ("app-a", app_a, "HTTP/app-a.localhost"),
            ("app-b", app_b, "HTTP/app-b.localhost"),
            ("wrong-spn", wrong_spn, "HTTP/app-b.localhost"),
        ):
            log_path = root / f"{name}.log"
            logs.append(log_path.open("w"))
            process = subprocess.Popen(
                [programs["java"], f"-Djava.security.krb5.conf={krb5_config}",
                 "-cp", str(classes), "SsoKerberosServer", str(port),
                 f"{principal}@{REALM}", str(root / "service.keytab"),
                 str(HERE.parents[2] / "packages/browser-sdk/dist")],
                env=env, stdout=logs[-1], stderr=subprocess.STDOUT,
            )
            processes.append(process)
            wait_for_server(process, port, name)

        check(request(app_a, "/sso/session")[2] == '{"authenticated":false}',
              "A must start without a session")
        status, headers, _ = request(app_a, "/sso/negotiate/start")
        check(status == 401 and headers.get("Www-authenticate") == "Negotiate",
              "Login must issue the Negotiate challenge")
        check("Www-authenticate" not in request(app_a, "/sso/session")[1],
              "Session endpoint must not challenge")

        jar_a, jar_b, jar_wrong = (root / f"{name}.cookies" for name in ("a", "b", "wrong"))
        check(negotiate(programs["curl"], env, "app-a.localhost", app_a, jar_a) == 302,
              "A Kerberos login must redirect")
        cookie_a = session_cookie(jar_a)
        check(json.loads(request(app_a, "/sso/session", cookie_a)[2])["authenticated"] is True,
              "A must establish its local session")
        check(request(app_b, "/sso/session", cookie_a)[2] == '{"authenticated":false}',
              "A cookie must not authenticate B")
        check(negotiate(programs["curl"], env, "app-b.localhost", app_b, jar_b) == 302,
              "B Kerberos login must redirect")
        cookie_b = session_cookie(jar_b)
        check(json.loads(request(app_b, "/sso/session", cookie_b)[2])["authenticated"] is True,
              "B must establish its own session")
        check(request(app_a, "/sso/logout", cookie_a)[0] == 405,
              "GET must not revoke A session")
        check(json.loads(request(app_a, "/sso/session", cookie_a)[2])["authenticated"] is True,
              "GET logout attempt must preserve A session")
        check(request(app_a, "/sso/logout", cookie_a, method="POST")[0] == 200,
              "POST A logout must respond")
        check(request(app_a, "/sso/session", cookie_a)[2] == '{"authenticated":false}',
              "A logout must revoke A session")
        check(json.loads(request(app_b, "/sso/session", cookie_b)[2])["authenticated"] is True,
              "A logout must preserve B session")
        check(negotiate(programs["curl"], env, "app-a.localhost", wrong_spn, jar_wrong) == 401,
              "Wrong service principal must fail")
        check("\tsso_lab\t" not in jar_wrong.read_text(),
              "Wrong service principal must not issue a session")
        malformed = request(app_a, "/sso/negotiate/start", authorization="Negotiate !!")
        check(malformed[0] == 401 and "Set-cookie" not in malformed[1],
              "Malformed token must not issue a session")
        ntlm = base64.b64encode(b"NTLMSSP\x00\x01\x00\x00\x00").decode()
        fallback = request(app_a, "/sso/negotiate/start", authorization=f"Negotiate {ntlm}")
        check(fallback[0] == 401 and "Set-cookie" not in fallback[1],
              "Synthetic NTLM marker must not issue a session")

        for stripped in ("WWW-Authenticate", "Authorization"):
            with altered_reverse_proxy(app_a, stripped) as proxy:
                if stripped == "WWW-Authenticate":
                    status, headers, _ = request(proxy.server_address[1], "/sso/negotiate/start")
                    check(status == 401 and "Www-authenticate" not in headers and
                          "Set-cookie" not in headers,
                          "Proxy must remove the anonymous Negotiate challenge without issuing a session")
                else:
                    jar = root / "proxy-authorization.cookies"
                    status = negotiate(programs["curl"], env, "app-a.localhost",
                                       proxy.server_address[1], jar)
                    check(status == 401 and "\tsso_lab\t" not in jar.read_text(),
                          "Proxy stripping Authorization must not create a session")
                    check(proxy.saw_authorization,
                          "Proxy must observe a client credential before stripping it")

        certificate, private_key, keystore = (root / name for name in ("tls.crt", "tls.key", "tls.p12"))
        password = secrets.token_hex(16)
        invoke([programs["openssl"], "req", "-x509", "-newkey", "rsa:2048", "-sha256",
                "-nodes", "-days", "1", "-keyout", str(private_key), "-out", str(certificate),
                "-subj", "/CN=app-a.localhost",
                "-addext", "subjectAltName=DNS:app-a.localhost,DNS:app-b.localhost,IP:127.0.0.1",
                "-addext", "basicConstraints=critical,CA:FALSE"])
        invoke([programs["openssl"], "pkcs12", "-export", "-in", str(certificate),
                "-inkey", str(private_key), "-out", str(keystore), "-passout", f"pass:{password}"])
        private_key.chmod(0o600)
        keystore.chmod(0o600)
        for name, port, principal in (
            ("tls-app-a", tls_a, "HTTP/app-a.localhost"),
            ("tls-app-b", tls_b, "HTTP/app-b.localhost"),
        ):
            log_path = root / f"{name}.log"
            logs.append(log_path.open("w"))
            process = subprocess.Popen(
                [programs["java"], f"-Djava.security.krb5.conf={krb5_config}",
                 "-cp", str(classes), "SsoKerberosServer", str(port),
                 f"{principal}@{REALM}", str(root / "service.keytab"),
                 str(HERE.parents[2] / "packages/browser-sdk/dist"), str(keystore), password],
                env=env, stdout=logs[-1], stderr=subprocess.STDOUT,
            )
            processes.append(process)
            wait_for_server(process, port, name)
        preflight_config = root / "preflight.json"
        preflight_config.write_text(json.dumps({
            "appA": {"origin": f"https://127.0.0.1:{tls_a}"},
            "appB": {"origin": f"https://127.0.0.1:{tls_b}"},
        }))
        preflight = subprocess.run(
            [programs["node"], str(HERE.parents[2] / "scripts/negotiate-domain-preflight.mjs"),
             str(preflight_config)],
            env=env | {"NODE_EXTRA_CA_CERTS": str(certificate)},
            capture_output=True, text=True,
        )
        check(preflight.returncode == 0,
              "HTTPS anonymous preflight failed: " + preflight.stdout + preflight.stderr)
        preflight_result = json.loads(preflight.stdout)
        check(preflight_result["passed"] and preflight_result["kerberosVerified"] is False
              and len(preflight_result["hosts"]) == 2,
              "HTTPS preflight must pass both origins without claiming Kerberos")
        untrusted_tls = subprocess.run(
            [programs["curl"], "--silent", "--show-error", "--noproxy", "*",
             "--resolve", f"app-a.localhost:{tls_a}:127.0.0.1",
             f"https://app-a.localhost:{tls_a}/sso/session"],
            env=env, capture_output=True, text=True,
        )
        check(untrusted_tls.returncode == 60,
              "Untrusted local HTTPS certificate must fail curl validation")
        tls_jar_a, tls_jar_b = root / "tls-a.cookies", root / "tls-b.cookies"
        check(negotiate(programs["curl"], env, "app-a.localhost", tls_a, tls_jar_a, certificate) == 302,
              "HTTPS A Kerberos login must redirect with a verified certificate")
        check(negotiate(programs["curl"], env, "app-b.localhost", tls_b, tls_jar_b, certificate) == 302,
              "HTTPS B Kerberos login must redirect with a verified certificate")
        check(secure_cookie(tls_jar_a) and secure_cookie(tls_jar_b),
              "HTTPS sessions must use Secure cookies")
        tls_cookie_a, tls_cookie_b = session_cookie(tls_jar_a), session_cookie(tls_jar_b)
        check(json.loads(tls_request(programs["curl"], env, "app-a.localhost", tls_a,
                                     certificate, "/sso/session", tls_cookie_a))["authenticated"],
              "HTTPS A must establish its local session")
        check(tls_request(programs["curl"], env, "app-b.localhost", tls_b,
                          certificate, "/sso/session", tls_cookie_a) == '{"authenticated":false}',
              "HTTPS A cookie must not authenticate B")
        check(json.loads(tls_request(programs["curl"], env, "app-b.localhost", tls_b,
                                     certificate, "/sso/session", tls_cookie_b))["authenticated"],
              "HTTPS B must establish its own session")
        check(json.loads(tls_request(programs["curl"], env, "app-a.localhost", tls_a,
                                     certificate, "/sso/session", tls_cookie_a))["authenticated"],
              "HTTPS A session must exist before logout")
        tls_request(programs["curl"], env, "app-a.localhost", tls_a,
                    certificate, "/sso/logout", tls_cookie_a)
        check(json.loads(tls_request(programs["curl"], env, "app-a.localhost", tls_a,
                                     certificate, "/sso/session", tls_cookie_a))["authenticated"],
              "HTTPS GET logout attempt must preserve A session")
        tls_request(programs["curl"], env, "app-a.localhost", tls_a,
                    certificate, "/sso/logout", tls_cookie_a, method="POST")
        check(tls_request(programs["curl"], env, "app-a.localhost", tls_a,
                          certificate, "/sso/session", tls_cookie_a) == '{"authenticated":false}',
              "HTTPS A logout must revoke A session")
        check(json.loads(tls_request(programs["curl"], env, "app-b.localhost", tls_b,
                                     certificate, "/sso/session", tls_cookie_b))["authenticated"],
              "HTTPS A logout must preserve B session")

        for log in logs:
            log.flush()
        for name in ("app-a", "app-b", "tls-app-a", "tls-app-b"):
            content = (root / f"{name}.log").read_text()
            check(f"accepted mechanism={KERBEROS_OID} identity=testuser@{REALM}" in content,
                  f"{name} server did not confirm the Kerberos mechanism")
        if firefox := os.environ.get("SSO_KERBEROS_FIREFOX"):
            probe_firefox(firefox, env, root, "app-a.localhost", app_a, root / "app-a.log")
            probe_firefox(firefox, env, root, "app-b.localhost", app_b, root / "app-b.log")
            print("PASS: browser SDK auto-login and session recovery with Kerberos on both Firefox hosts")
            probe_untrusted_firefox(firefox, env, root, "app-a.localhost", app_a, root / "app-a.log")
            print("PASS: Firefox without trusted-uris reached challenge but established no session")
            probe_tls_firefox(firefox, command("geckodriver"), env, root, (
                ("app-a.localhost", tls_a, root / "tls-app-a.log"),
                ("app-b.localhost", tls_b, root / "tls-app-b.log"),
            ))
            print("PASS: Firefox HTTPS SDK login, POST local logout, B session preservation, and A reauthentication")
        print("PASS: real local Kerberos tickets and Java GSSAPI HTTP Negotiate on two hosts")
        print("PASS: certificate-verified HTTPS Kerberos on two hosts with Secure cookies and independent sessions")
        print("PASS: shared anonymous HTTPS preflight against both local TLS services")
        print("PASS: independent sessions, A logout, wrong SPN, malformed token, synthetic NTLM marker, stripped proxy headers")
        print("LIMIT: loopback test certificate; no enterprise-managed browser, certificate chain, or proxy topology validation")
    finally:
        for process in reversed(processes):
            process.terminate()
        for process in reversed(processes):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for log in logs:
            log.close()


def main():
    home = Path(os.environ.get("KRB5_HOME", "/opt/homebrew/opt/krb5"))
    programs = {
        name: command(name, home / ("sbin" if name in {"kdb5_util", "kadmin.local", "krb5kdc"} else "bin"))
        for name in ("kdb5_util", "kadmin.local", "krb5kdc", "kinit", "kvno")
    }
    programs |= {name: command(name) for name in ("curl", "javac", "java", "openssl", "node")}
    with tempfile.TemporaryDirectory(prefix="sso-kerberos-") as temporary:
        root = Path(temporary)
        root.chmod(0o700)
        run(root, programs)


if __name__ == "__main__":
    main()
