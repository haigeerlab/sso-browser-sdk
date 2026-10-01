import os
from pathlib import Path


SECRET_KEY = 'local-cas-interop-only'
DEBUG = True
ALLOWED_HOSTS = ['localhost', '127.0.0.1']
ROOT_URLCONF = 'urls'
BASE_DIR = Path(__file__).resolve().parent

INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'cas_server',
]
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
]
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'APP_DIRS': True,
    'OPTIONS': {
        'context_processors': [
            'django.template.context_processors.debug',
            'django.template.context_processors.request',
            'django.contrib.auth.context_processors.auth',
            'django.contrib.messages.context_processors.messages',
        ],
    },
}]
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.environ.get('SSO_CAS_DB', str(BASE_DIR / 'local.sqlite3')),
    },
}
STATIC_URL = '/static/'
DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'
CAS_NEW_VERSION_HTML_WARNING = False
CAS_NEW_VERSION_EMAIL_WARNING = False
CAS_TICKET_VALIDITY = int(os.environ.get('SSO_CAS_TICKET_VALIDITY', '60'))
