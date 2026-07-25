from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def broadcast(script_id, event_type, payload, actor="user"):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        f"script_{script_id}",
        {
            "type": "script.event",
            "event": {
                "type": event_type,
                "actor": actor,
                "object": payload,
            },
        },
    )


def actor_from_request(request):
    auth = getattr(request, "auth", None)
    if auth is not None:
        return f"agent:{getattr(auth, 'description', None) or getattr(auth, 'pk', 'token')}"
    client_id = request.headers.get("X-Client-Id")
    if client_id:
        return f"client:{client_id}"
    return "user"
