import time

from asgiref.sync import async_to_sync
from channels.generic.websocket import JsonWebsocketConsumer

PRESENCE_TTL_SECONDS = 30


class ScriptConsumer(JsonWebsocketConsumer):
    def connect(self):
        self.script_id = self.scope["url_route"]["kwargs"]["script_id"]
        self.group_name = f"script_{self.script_id}"
        async_to_sync(self.channel_layer.group_add)(self.group_name, self.channel_name)
        self.accept()

    def disconnect(self, close_code):
        async_to_sync(self.channel_layer.group_discard)(self.group_name, self.channel_name)

    def receive_json(self, content, **kwargs):
        msg_type = content.get("type")
        if msg_type == "presence":
            block_id = content.get("block_id")
            holder = content.get("holder", "user")
            action = content.get("action", "acquire")
            async_to_sync(self.channel_layer.group_send)(
                self.group_name,
                {
                    "type": "script.event",
                    "event": {
                        "type": f"presence.{action}d",
                        "actor": holder,
                        "object": {
                            "block_id": block_id,
                            "holder": holder,
                            "expires": time.time() + PRESENCE_TTL_SECONDS,
                        },
                    },
                },
            )
        elif msg_type == "ping":
            self.send_json({"type": "pong", "ts": time.time()})

    def script_event(self, event):
        self.send_json(event["event"])
