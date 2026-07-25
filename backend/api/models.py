from django.db import models

AUTO_DURATION_CAP_SECONDS = 600.0


class Project(models.Model):
    name = models.CharField(max_length=255)
    default_wpm = models.PositiveIntegerField(default=150)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Script(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        FINAL = "final", "Final"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="scripts")
    title = models.CharField(max_length=255)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    target_length_min = models.FloatField(null=True, blank=True)
    wpm_override = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def effective_wpm(self):
        return self.wpm_override or self.project.default_wpm

    def __str__(self):
        return self.title


class Track(models.Model):
    KIND_DEFAULT_NAMES = {
        "voiceover": "Voiceover / Main Script",
        "broll": "B-Roll & Visual Notes",
        "resources": "Resources & Links",
        "images": "Images",
    }

    TRACK_COLOR_PALETTE = [
        "#2e7d4f",
        "#3a5f8a",
        "#8a6d3a",
        "#6b5b8e",
        "#8a4a4a",
        "#3a7d7a",
    ]

    script = models.ForeignKey(Script, on_delete=models.CASCADE, related_name="tracks")
    kind = models.CharField(max_length=64)
    name = models.CharField(max_length=255)
    order = models.PositiveIntegerField(default=0)
    color = models.CharField(max_length=16, blank=True, default="")
    is_script_track = models.BooleanField(default=False)

    class Meta:
        ordering = ["order", "id"]

    def save(self, *args, **kwargs):
        if not self.color:
            used = list(self.script.tracks.values_list("color", flat=True)) if self.script_id else []
            for c in self.TRACK_COLOR_PALETTE:
                if c not in used:
                    self.color = c
                    break
            else:
                self.color = self.TRACK_COLOR_PALETTE[len(used) % len(self.TRACK_COLOR_PALETTE)]
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.script.title} / {self.name}"


class Block(models.Model):
    class ClipKind(models.TextChoices):
        MUTED = "muted", "Muted Background Clip"
        CLIP = "clip", "Clip"
        FULL = "full", "Full Clip"

    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name="blocks")
    title = models.CharField(max_length=255, blank=True, default="")
    clip_kind = models.CharField(max_length=8, choices=ClipKind.choices, blank=True, default="")
    source_url = models.URLField(blank=True, default="")
    source_in_seconds = models.FloatField(null=True, blank=True)
    source_out_seconds = models.FloatField(null=True, blank=True)
    editor_note = models.TextField(blank=True, default="")
    start_seconds = models.FloatField(default=0.0)
    duration_seconds = models.FloatField(default=0.0)
    content = models.JSONField(default=dict, blank=True)
    content_markdown = models.TextField(blank=True, default="")
    word_count = models.PositiveIntegerField(default=0)
    wpm_override = models.PositiveIntegerField(null=True, blank=True)
    anchor_block = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="anchored_children"
    )
    anchor_offset_seconds = models.FloatField(default=0.0)
    color_tag = models.CharField(max_length=32, blank=True, default="")
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_seconds", "id"]

    def __str__(self):
        return f"Block {self.pk} ({self.track.kind})"

    @property
    def is_voiceover(self):
        return self.track.is_script_track

    def effective_wpm(self):
        return self.wpm_override or self.track.script.effective_wpm

    def auto_duration(self):
        if self.word_count <= 0:
            return 0.0
        seconds = self.word_count / self.effective_wpm() * 60.0
        return min(seconds, AUTO_DURATION_CAP_SECONDS)

    def recompute_auto_duration(self):
        if self.is_voiceover:
            self.duration_seconds = self.auto_duration()


class Tag(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tags")
    label = models.CharField(max_length=128)
    color = models.CharField(max_length=16, blank=True, default="")
    blocks = models.ManyToManyField(Block, through="BlockTag", related_name="tags")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "label"], name="unique_tag_label_per_project")
        ]

    def __str__(self):
        return self.label


class Resource(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="resources")
    title = models.CharField(max_length=255)
    url = models.URLField(blank=True, default="")
    note = models.TextField(blank=True, default="")
    blocks = models.ManyToManyField(Block, through="BlockResource", related_name="resources")

    def __str__(self):
        return self.title


class BlockTag(models.Model):
    block = models.ForeignKey(Block, on_delete=models.CASCADE)
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["block", "tag"], name="unique_block_tag")]


class BlockResource(models.Model):
    block = models.ForeignKey(Block, on_delete=models.CASCADE)
    resource = models.ForeignKey(Resource, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["block", "resource"], name="unique_block_resource")
        ]
