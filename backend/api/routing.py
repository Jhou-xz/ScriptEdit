from django.urls import re_path

from .consumers import ScriptConsumer

websocket_urlpatterns = [
    re_path(r"^ws/scripts/(?P<script_id>\d+)/$", ScriptConsumer.as_asgi()),
]
