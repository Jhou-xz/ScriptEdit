from rest_framework import serializers

from .models import Block, Project, Resource, Script, Tag, Track


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "name", "default_wpm", "created_at"]
        read_only_fields = ["id", "created_at"]


class ScriptSerializer(serializers.ModelSerializer):
    effective_wpm = serializers.IntegerField(read_only=True)

    class Meta:
        model = Script
        fields = [
            "id", "project", "title", "status", "target_length_min",
            "wpm_override", "effective_wpm", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class TrackSerializer(serializers.ModelSerializer):
    class Meta:
        model = Track
        fields = ["id", "script", "kind", "name", "order", "color", "is_script_track"]
        read_only_fields = ["id"]


class TagSerializer(serializers.ModelSerializer):
    block_ids = serializers.PrimaryKeyRelatedField(
        source="blocks", many=True, read_only=True
    )

    class Meta:
        model = Tag
        fields = ["id", "project", "label", "color", "block_ids"]
        read_only_fields = ["id"]


class ResourceSerializer(serializers.ModelSerializer):
    block_ids = serializers.PrimaryKeyRelatedField(
        source="blocks", many=True, read_only=True
    )

    class Meta:
        model = Resource
        fields = ["id", "project", "title", "url", "note", "block_ids"]
        read_only_fields = ["id"]


class BlockSerializer(serializers.ModelSerializer):
    tag_ids = serializers.PrimaryKeyRelatedField(
        source="tags", many=True, read_only=True
    )
    resource_ids = serializers.PrimaryKeyRelatedField(
        source="resources", many=True, read_only=True
    )

    class Meta:
        model = Block
        fields = [
            "id", "track", "title", "clip_kind", "source_url",
            "source_in_seconds", "source_out_seconds", "editor_note",
            "start_seconds", "duration_seconds",
            "content", "content_markdown", "word_count", "wpm_override",
            "anchor_block", "anchor_offset_seconds", "color_tag",
            "tag_ids", "resource_ids", "version", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "word_count", "content_markdown", "version", "created_at", "updated_at"]

    def validate_anchor_block(self, value):
        if value is not None and not value.track.is_script_track:
            raise serializers.ValidationError("Anchor target must be on a script track.")
        return value

    def validate(self, attrs):
        if self.instance is not None and "version" in self.initial_data:
            incoming = self.initial_data.get("version")
            try:
                incoming = int(incoming)
            except (TypeError, ValueError):
                raise serializers.ValidationError({"version": "Invalid version."})
            if incoming != self.instance.version:
                raise serializers.ValidationError(
                    {"version": f"Stale write: server is at version {self.instance.version}."}
                )
        return attrs


class ScriptStateSerializer(serializers.Serializer):
    script = ScriptSerializer()
    tracks = TrackSerializer(many=True)
    blocks = BlockSerializer(many=True)
    tags = TagSerializer(many=True)
    resources = ResourceSerializer(many=True)
