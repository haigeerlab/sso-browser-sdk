from django.urls import include, path


urlpatterns = [path('cas/', include('cas_server.urls', namespace='cas_server'))]
