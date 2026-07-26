from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .broadcast import actor_from_request, broadcast
from .markdown import tiptap_to_markdown, word_count
from .models import Block, BlockResource, BlockTag, Project, Resource, Script, Tag, Track
from .serializers import (
    BlockSerializer,
    ProjectSerializer,
    ResourceSerializer,
    ScriptSerializer,
    ScriptStateSerializer,
    TagSerializer,
    TrackSerializer,
)


def _script_id_for_block(block):
    return block.track.script_id


class MediaUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file = request.FILES.get("file")
        if file is None:
            return Response({"file": "required"}, status=status.HTTP_400_BAD_REQUEST)
        if not file.content_type.startswith("image/"):
            return Response(
                {"file": "Only image uploads are supported."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from django.core.files.storage import default_storage

        path = default_storage.save(f"uploads/{file.name}", file)
        return Response(
            {"url": f"/media/{path}"}, status=status.HTTP_201_CREATED
        )


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer


class ScriptViewSet(viewsets.ModelViewSet):
    queryset = Script.objects.select_related("project").all()
    serializer_class = ScriptSerializer

    def perform_create(self, serializer):
        script = serializer.save()
        for order, (kind, name) in enumerate(Track.KIND_DEFAULT_NAMES.items()):
            Track.objects.create(
                script=script,
                kind=kind,
                name=name,
                order=order,
                is_script_track=(kind == "voiceover"),
            )

    @action(detail=True, methods=["get"])
    def state(self, request, pk=None):
        script = self.get_object()
        data = {
            "script": script,
            "tracks": script.tracks.all(),
            "blocks": Block.objects.filter(track__script=script).prefetch_related("tags", "resources"),
            "tags": Tag.objects.filter(project=script.project).prefetch_related("blocks"),
            "resources": Resource.objects.filter(project=script.project).prefetch_related("blocks"),
        }
        return Response(ScriptStateSerializer(data).data)

    @action(detail=False, methods=["post"], url_path="import")
    def import_docx(self, request):
        from .services.docx_import import import_docx_file

        file = request.FILES.get("file")
        if file is None:
            return Response({"file": "required"}, status=status.HTTP_400_BAD_REQUEST)
        if not file.name.lower().endswith(".docx"):
            return Response(
                {"file": "Only .docx files are supported."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            script, stats = import_docx_file(
                file,
                project_name=request.data.get("project"),
                title=request.data.get("title") or file.name,
            )
        except Exception as e:
            return Response(
                {"detail": f"Import failed: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {"script": ScriptSerializer(script).data, "stats": stats},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="auto_layout")
    def auto_layout(self, request, pk=None):
        from .services import ai_layout

        script = self.get_object()
        if not ai_layout.is_configured():
            return Response(
                {
                    "detail": "AI layout is not configured. Set OPENAI_API_KEY or "
                    "ANTHROPIC_API_KEY in the server environment."
                },
                status=status.HTTP_501_NOT_IMPLEMENTED,
            )
        try:
            layout = ai_layout.suggest_layout(script)
        except Exception as e:
            return Response(
                {"detail": f"AI provider error: {e}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        applied = ai_layout.apply_layout(script, layout)
        actor = actor_from_request(request)
        for block in Block.objects.filter(track__script=script).prefetch_related("tags", "resources"):
            broadcast(script.pk, "block.updated", BlockSerializer(block).data, actor=actor)
        return Response({"applied": applied, "layout": layout})

    @action(detail=True, methods=["post"], url_path="chat")
    def chat(self, request, pk=None):
        from .services import ai_chat
        from django.http import StreamingHttpResponse

        script = self.get_object()
        messages = request.data.get("messages", [])
        target_block_id = request.data.get("target_block_id")
        web_search = bool(request.data.get("web_search", False))

        if target_block_id is not None:
            try:
                target_block_id = int(target_block_id)
            except (ValueError, TypeError):
                target_block_id = None

        response = StreamingHttpResponse(
            ai_chat.stream_chat_response(script, messages, target_block_id, web_search),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response



    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        script = self.get_object()
        fmt = request.query_params.get("fmt", "docx")
        if fmt == "json":
            return self.state(request, pk)
        if fmt == "docx":
            from .services.docx_export import export_script_docx

            payload = export_script_docx(script)
            response = HttpResponse(
                payload,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            response["Content-Disposition"] = (
                f'attachment; filename="script_{script.pk}.docx"'
            )
            return response
        text = export_script_text(script)
        response = HttpResponse(text, content_type="text/plain; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="script_{script.pk}.txt"'
        return response


class TrackViewSet(viewsets.ModelViewSet):
    queryset = Track.objects.select_related("script").all()
    serializer_class = TrackSerializer


def _refresh_block_content_fields(block):
    block.word_count = word_count(block.content)
    block.content_markdown = tiptap_to_markdown(block.content)
    block.recompute_auto_duration()


def _shift_anchored_children(block, delta, actor):
    if delta == 0:
        return
    children = list(block.anchored_children.all())
    for child in children:
        child.start_seconds = max(0.0, child.start_seconds + delta)
        child.version += 1
        child.save(update_fields=["start_seconds", "version", "updated_at"])
        broadcast(
            _script_id_for_block(child),
            "block.updated",
            BlockSerializer(child).data,
            actor=actor,
        )


def _fresh_block(block):
    return Block.objects.prefetch_related("tags", "resources").get(pk=block.pk)


class BlockViewSet(viewsets.ModelViewSet):
    queryset = Block.objects.select_related("track", "track__script").prefetch_related(
        "tags", "resources"
    )
    serializer_class = BlockSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        script_id = self.request.query_params.get("script")
        if script_id:
            qs = qs.filter(track__script_id=script_id)
        return qs

    def perform_create(self, serializer):
        with transaction.atomic():
            block = serializer.save()
            _refresh_block_content_fields(block)
            block.save()
        broadcast(
            _script_id_for_block(block), "block.created", BlockSerializer(block).data,
            actor=actor_from_request(self.request),
        )

    def perform_update(self, serializer):
        old_start = serializer.instance.start_seconds
        with transaction.atomic():
            block = serializer.save()
            _refresh_block_content_fields(block)
            block.version += 1
            block.save()
        actor = actor_from_request(self.request)
        broadcast(
            _script_id_for_block(block), "block.updated", BlockSerializer(block).data, actor=actor
        )
        if block.is_voiceover and block.start_seconds != old_start:
            _shift_anchored_children(block, block.start_seconds - old_start, actor)

    def perform_destroy(self, instance):
        script_id = _script_id_for_block(instance)
        block_id = instance.pk
        instance.delete()
        broadcast(script_id, "block.deleted", {"id": block_id}, actor=actor_from_request(self.request))

    @action(detail=True, methods=["patch"])
    def move(self, request, pk=None):
        block = self.get_object()
        start = request.data.get("start_seconds")
        track_id = request.data.get("track_id")
        if start is None:
            return Response({"start_seconds": "required"}, status=status.HTTP_400_BAD_REQUEST)
        old_start = block.start_seconds
        block.start_seconds = float(start)
        if track_id is not None:
            track = get_object_or_404(Track, pk=track_id, script=block.track.script)
            block.track = track
        block.version += 1
        block.save(update_fields=["start_seconds", "track", "version", "updated_at"])
        actor = actor_from_request(request)
        broadcast(
            _script_id_for_block(block), "block.moved", BlockSerializer(block).data, actor=actor
        )
        if block.is_voiceover and block.start_seconds != old_start:
            _shift_anchored_children(block, block.start_seconds - old_start, actor)
        return Response(BlockSerializer(block).data)

    @action(detail=True, methods=["patch"])
    def resize(self, request, pk=None):
        block = self.get_object()
        duration = request.data.get("duration_seconds")
        if duration is None:
            return Response({"duration_seconds": "required"}, status=status.HTTP_400_BAD_REQUEST)
        block.duration_seconds = max(0.0, float(duration))
        block.version += 1
        block.save(update_fields=["duration_seconds", "version", "updated_at"])
        broadcast(
            _script_id_for_block(block),
            "block.updated",
            BlockSerializer(block).data,
            actor=actor_from_request(request),
        )
        return Response(BlockSerializer(block).data)

    @action(detail=True, methods=["post"], url_path="tags/(?P<tag_id>[^/.]+)")
    def attach_tag(self, request, pk=None, tag_id=None):
        block = self.get_object()
        tag = get_object_or_404(Tag, pk=tag_id, project=block.track.script.project)
        BlockTag.objects.get_or_create(block=block, tag=tag)
        data = BlockSerializer(_fresh_block(block)).data
        broadcast(
            _script_id_for_block(block), "tag.attached", data, actor=actor_from_request(request)
        )
        return Response(data)

    @attach_tag.mapping.delete
    def detach_tag(self, request, pk=None, tag_id=None):
        block = self.get_object()
        BlockTag.objects.filter(block=block, tag_id=tag_id).delete()
        data = BlockSerializer(_fresh_block(block)).data
        broadcast(
            _script_id_for_block(block), "tag.detached", data, actor=actor_from_request(request)
        )
        return Response(data)

    @action(detail=True, methods=["post"], url_path="resources/(?P<resource_id>[^/.]+)")
    def attach_resource(self, request, pk=None, resource_id=None):
        block = self.get_object()
        resource = get_object_or_404(
            Resource, pk=resource_id, project=block.track.script.project
        )
        BlockResource.objects.get_or_create(block=block, resource=resource)
        data = BlockSerializer(_fresh_block(block)).data
        broadcast(
            _script_id_for_block(block),
            "resource.attached",
            data,
            actor=actor_from_request(request),
        )
        return Response(data)

    @attach_resource.mapping.delete
    def detach_resource(self, request, pk=None, resource_id=None):
        block = self.get_object()
        BlockResource.objects.filter(block=block, resource_id=resource_id).delete()
        data = BlockSerializer(_fresh_block(block)).data
        broadcast(
            _script_id_for_block(block),
            "resource.detached",
            data,
            actor=actor_from_request(request),
        )
        return Response(data)

    @action(detail=True, methods=["post", "delete"])
    def anchor(self, request, pk=None):
        block = self.get_object()
        if request.method == "DELETE":
            block.anchor_block = None
            block.anchor_offset_seconds = 0.0
        else:
            anchor_id = request.data.get("anchor_block")
            anchor = get_object_or_404(Block, pk=anchor_id)
            if not anchor.track.is_script_track:
                return Response(
                    {"anchor_block": "Anchor target must be on a script track."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if anchor.pk == block.pk:
                return Response(
                    {"anchor_block": "A block cannot anchor to itself."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            block.anchor_block = anchor
            block.anchor_offset_seconds = float(request.data.get("offset_seconds", 0.0))
        block.version += 1
        block.save(
            update_fields=["anchor_block", "anchor_offset_seconds", "version", "updated_at"]
        )
        broadcast(
            _script_id_for_block(block),
            "block.updated",
            BlockSerializer(block).data,
            actor=actor_from_request(request),
        )
        return Response(BlockSerializer(block).data)


class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.prefetch_related("blocks").all()
    serializer_class = TagSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs


class ResourceViewSet(viewsets.ModelViewSet):
    queryset = Resource.objects.prefetch_related("blocks").all()
    serializer_class = ResourceSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs


def _fmt_ts(seconds):
    seconds = max(0, int(seconds))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def _clip_line(b):
    parts = []
    if b.clip_kind:
        parts.append(b.get_clip_kind_display().upper())
    else:
        parts.append(b.track.name.upper())
    parts.append(f"{_fmt_ts(b.start_seconds)}–{_fmt_ts(b.start_seconds + b.duration_seconds)}")
    if b.source_url:
        parts.append(b.source_url)
    if b.source_in_seconds is not None:
        in_s = _fmt_ts(b.source_in_seconds)
        out_s = _fmt_ts(b.source_out_seconds) if b.source_out_seconds is not None else "?"
        parts.append(f"in {in_s} out {out_s}")
    if b.editor_note:
        parts.append(f"note: {b.editor_note}")
    if b.content_markdown:
        parts.append(b.content_markdown.replace("\n", " "))
    return "  > " + " · ".join(parts)


def export_script_text(script):
    lines = [f"# {script.title}", ""]
    vo_blocks = list(
        Block.objects.filter(track__script=script, track__is_script_track=True).order_by(
            "start_seconds"
        )
    )
    other_blocks = list(
        Block.objects.filter(track__script=script)
        .exclude(track__is_script_track=True)
        .order_by("start_seconds")
    )
    for block in vo_blocks:
        heading = block.title or "Untitled Section"
        lines.append(
            f"## [{_fmt_ts(block.start_seconds)} – {_fmt_ts(block.start_seconds + block.duration_seconds)}] {heading}"
        )
        if block.content_markdown:
            lines.append(block.content_markdown)
        related = [
            b
            for b in other_blocks
            if b.anchor_block_id == block.id
            or (
                b.anchor_block_id is None
                and b.start_seconds < block.start_seconds + block.duration_seconds
                and b.start_seconds + b.duration_seconds > block.start_seconds
            )
        ]
        for b in related:
            lines.append(_clip_line(b))
        lines.append("")
    loose = [
        b
        for b in other_blocks
        if b.anchor_block_id is None
        and not any(
            b.start_seconds < v.start_seconds + v.duration_seconds
            and b.start_seconds + b.duration_seconds > v.start_seconds
            for v in vo_blocks
        )
    ]
    if loose:
        lines.append("## Unplaced References")
        for b in loose:
            lines.append(_clip_line(b))
        lines.append("")
    return "\n".join(lines)
