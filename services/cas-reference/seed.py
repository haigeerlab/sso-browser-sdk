import os

import django


os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'settings')
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from cas_server.models import ServicePattern  # noqa: E402


host_port = int(os.environ['SSO_CAS_HOST_PORT'])
get_user_model().objects.create_user(username='demo', password='demo')
for app in ('app-a', 'app-b'):
    ServicePattern.objects.create(
        name=app,
        pattern=rf'^http://127\.0\.0\.1:{host_port}/{app}/auth/cas/callback\?state=[0-9a-f-]+$',
    )
