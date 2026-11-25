# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
#
# Checks clio_cutout.gd against the tested player (js/cutout.js): the same cutout, the same clips, the
# same moments, and every picture must be in the same place. Run from the repository's top folder:
#
#   node tools/gaitbake.js soldier --out out
#   node tools/godot/expect_cutout.js out/soldier_cutout.json out/soldier_expect.json
#   godot --headless --script tools/godot/check_cutout.gd -- out/soldier_cutout.json out/soldier_expect.json
#
# It prints the largest difference it finds and ends with "ok" or "FAILED".
# NOT YET RUN IN GODOT either: if it stops with a script error, that is the first thing to tell us.
extends SceneTree


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		print("usage: godot --headless --script tools/godot/check_cutout.gd -- <name>_cutout.json <expect>.json")
		quit(2)
		return
	var player_script = load(ProjectSettings.globalize_path("res://").path_join("tools/godot/clio_cutout.gd"))
	if player_script == null:
		player_script = load("tools/godot/clio_cutout.gd")
	var player = player_script.new()
	player.pixels_per_metre = 1.0
	player.playing = false
	get_root().add_child(player)
	if not player.load_pack(args[0]):
		print("FAILED: the cutout could not be loaded")
		quit(1)
		return
	var expect = JSON.parse_string(FileAccess.get_file_as_string(args[1]))
	var worst := 0.0
	var where := ""
	var count := 0
	for moment in expect["moments"]:
		player.show_at(moment["clip"], moment["time"])
		var rig: Node2D = player.get_child(0)
		for k in rig.get_child_count():
			var s: Sprite2D = rig.get_child(k)
			var want = moment["sprites"][k]
			if want == null:
				continue
			# where the two ends of the picture's top edge come to lie, against where the tested player puts them
			var rect: Rect2 = (s.texture as AtlasTexture).region
			var p0: Vector2 = s.transform * s.offset
			var p1: Vector2 = s.transform * (s.offset + Vector2(rect.size.x, 0))
			var d: float = max(p0.distance_to(Vector2(want[0], want[1])), p1.distance_to(Vector2(want[2], want[3])))
			if s.z_index != int(want[4]):
				d = max(d, 1.0)
			count += 1
			if d > worst:
				worst = d
				where = "%s at %.3f s, picture %d" % [moment["clip"], moment["time"], k]
	print("%d pictures in %d moments; largest difference %.6f m (%s)" % [count, expect["moments"].size(), worst, where])
	print("ok" if worst < 0.0001 else "FAILED")
	quit(0 if worst < 0.0001 else 1)
