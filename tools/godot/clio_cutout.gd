# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
#
# Plays a CLIo Motion 2D cutout in Godot 4: <name>_cutout.json and <name>_cutout.png, as the baker
# (node tools/gaitbake.js) and Gait Bench write them. Every part of the character is a Sprite2D of its
# own; this node moves them, so the motion is smooth at any frame rate.
#
#   1. Put both files in the project (next to each other).
#   2. Add a Node2D, attach this script, set Pack to the .json file.
#   3. Call play("walk"), or set clip and time yourself and call show_at().
#
# The node's origin is the point on the ground under the body. Pixels Per Metre sets its size.
#
# NOT YET RUN IN GODOT. It was written from the Godot 4 documentation and follows js/cutout.js line
# for line; js/cutout.js is the player that has been tested. tools/godot/check_cutout.gd compares the
# two on your machine: see the top of that file.
class_name ClioCutout
extends Node2D

@export_file("*.json") var pack: String = ""
@export var pixels_per_metre: float = 100.0
@export var clip: String = "idle"
@export var playing: bool = true
@export var speed: float = 1.0
@export var face_left: bool = false

var time: float = 0.0
var _data: Dictionary = {}
var _rig: Node2D = null
var _sprites: Array = []


func _ready() -> void:
	if pack != "":
		load_pack(pack)


## Reads the .json and the picture next to it, and makes one Sprite2D for each part.
func load_pack(path: String) -> bool:
	var text := FileAccess.get_file_as_string(path)
	var parsed = JSON.parse_string(text) if text != "" else null
	if typeof(parsed) != TYPE_DICTIONARY or parsed.get("format", "") != "clio-motion-cutout":
		push_error("ClioCutout: %s is not a cutout file" % path)
		return false
	var picture: String = path.get_base_dir().path_join(parsed["image"])
	var texture: Texture2D = null
	if ResourceLoader.exists(picture):
		texture = load(picture) as Texture2D
	if texture == null:
		# not a picture the project has imported: read the file as it is
		var raw := Image.load_from_file(picture)
		if raw != null:
			texture = ImageTexture.create_from_image(raw)
	if texture == null:
		push_error("ClioCutout: the picture %s is not next to %s" % [parsed["image"], path])
		return false
	_data = parsed
	if _rig != null:
		_rig.queue_free()
	_rig = Node2D.new()
	add_child(_rig)
	_sprites.clear()
	for sp in _data["sprites"]:
		var region := AtlasTexture.new()
		region.atlas = texture
		region.region = Rect2(sp["rect"][0], sp["rect"][1], sp["rect"][2], sp["rect"][3])
		var s := Sprite2D.new()
		s.texture = region
		s.centered = false
		s.offset = Vector2(-sp["pivot"][0], -sp["pivot"][1])   # the pivot of the picture sits on the node's origin
		_rig.add_child(s)
		_sprites.append(s)
	if not _data["clips"].has(clip):
		clip = "idle"
	show_at(clip, time)
	return true


func clips() -> PackedStringArray:
	return PackedStringArray(_data.get("clips", {}).keys())


func play(clip_name: String, from: float = 0.0) -> void:
	clip = clip_name
	time = from
	playing = true


## True when a clip that plays once has reached its end.
func finished() -> bool:
	if _data.is_empty() or not _data["clips"].has(clip):
		return true
	var c: Dictionary = _data["clips"][clip]
	return not c["loop"] and time >= c["seconds"]


func _process(delta: float) -> void:
	if playing and not _data.is_empty():
		time += delta * speed
		show_at(clip, time)


## Puts every picture where it is at that moment of that clip.
func show_at(clip_name: String, t: float) -> void:
	if _data.is_empty() or not _data["clips"].has(clip_name):
		return
	var c: Dictionary = _data["clips"][clip_name]
	var times: Array = c["times"]
	var frames: Array = c["frames"]
	var n := times.size()
	var total: float = c["seconds"]
	if c["loop"]:
		t = fposmod(t, total)
	else:
		t = clampf(t, 0.0, times[n - 1])
	var i := n - 1
	while i > 0 and times[i] > t:
		i -= 1
	var j := i
	if i + 1 < n:
		j = i + 1
	elif c["loop"]:
		j = 0
	var t0: float = times[i]
	var t1: float = t0
	if j > i:
		t1 = times[j]
	elif c["loop"]:
		t1 = total
	var u := 0.0
	if t1 > t0:
		u = (t - t0) / (t1 - t0)
	_rig.scale = Vector2(-pixels_per_metre if face_left else pixels_per_metre, pixels_per_metre)
	for k in _sprites.size():
		var a = frames[i][k]
		var b = frames[j][k]
		var s: Sprite2D = _sprites[k]
		if a == null:
			s.visible = false
			continue
		s.visible = true
		var x: float = a[0]
		var y: float = a[1]
		var angle: float = a[2]
		var sx: float = a[3]
		var sy: float = a[4]
		# between two frames: a straight line, turning the short way round; held if the part has been mirrored
		if b != null and u > 0.0 and a[3] * b[3] > 0.0 and a[4] * b[4] > 0.0:
			x = lerpf(a[0], b[0], u)
			y = lerpf(a[1], b[1], u)
			angle = lerp_angle(a[2], b[2], u)
			sx = lerpf(a[3], b[3], u)
			sy = lerpf(a[4], b[4], u)
		s.transform = Transform2D(angle, Vector2(sx, sy), 0.0, Vector2(x, y))
		s.z_index = int(a[5])
		s.modulate = Color(a[6], a[6], a[6], 1.0)
