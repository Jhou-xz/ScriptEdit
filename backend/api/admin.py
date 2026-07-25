from django.contrib import admin

from .models import Block, Project, Resource, Script, Tag, Track

admin.site.register([Project, Script, Track, Block, Tag, Resource])
