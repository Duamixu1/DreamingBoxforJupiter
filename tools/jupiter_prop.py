"""把 Tripo 导出的布景小件（树、花、蝴蝶、装饰）处理成 Jupiter 相框能用的 GLB。

Tripo 原始输出通常 200 万面、60 MB 以上，贴图 4096。Jupiter 每帧要画 9 个视点（RK3566），
整盒每视点建议 ≤ 3 万面，所以：

  1. 体素重建一个干净封闭的网格（Tripo 网格零件互相穿插，直接减面会卡在 1~2 万面或裂开）；
  2. 减面到 faces 面以内（重复摆放的东西会实例化，单个越省越好）；
  3. 新展 UV，把原模型颜色烘焙到 tex×tex 的贴图上；只留颜色贴图（盒子里用 Lambert）；
  4. 原点挪到模型底面中心、+Y 朝上，代码按高度缩放后直接立在地上。

用法（在 Jupitermusic/ 下）：
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/jupiter_prop.py -- \
      <输入.glb> <输出.glb> [--faces 1500] [--tex 512] [--voxel 0.006]
"""
import sys
import argparse
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('out')
ap.add_argument('--faces', type=int, default=1500)
ap.add_argument('--tex', type=int, default=512)
ap.add_argument('--voxel', type=float, default=0.006, help='体素大小（占模型最大边长的比例）；薄叶片丢了就调小')
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
if len(objs) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


before = tris(obj)
size = max(obj.dimensions)

# Tripo 的网格零件互相穿插，有大量"一条边连三个以上面"的非流形边，Blender 减面遇到就绕开，
# 直接减只能减到 1~2 万面。所以：体素重建一个干净封闭的网格 → 减面 → 新展 UV → 把原模型颜色烘焙上去
high = obj
low = high.copy()
low.data = high.data.copy()
bpy.context.collection.objects.link(low)
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = low
low.select_set(True)
rm = low.modifiers.new('rm', 'REMESH')
rm.mode = 'VOXEL'
rm.voxel_size = size * a.voxel
rm.adaptivity = 0
bpy.ops.object.modifier_apply(modifier='rm')
print(f'[prop] 体素重建 {tris(low)} 面')
for _ in range(6):
    cur = tris(low)
    if cur <= a.faces * 1.05:
        break
    dec = low.modifiers.new('dec', 'DECIMATE')
    dec.ratio = a.faces / cur
    bpy.ops.object.modifier_apply(modifier='dec')
bpy.ops.object.shade_smooth()

while low.data.uv_layers:
    low.data.uv_layers.remove(low.data.uv_layers[0])
low.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.2, island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')

img = bpy.data.images.new('prop_color', a.tex, a.tex, alpha=False)
mat = bpy.data.materials.new('prop')
mat.use_nodes = True
tn = mat.node_tree.nodes.new('ShaderNodeTexImage')
tn.image = img
mat.node_tree.links.new(tn.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
mat.node_tree.nodes.active = tn
low.data.materials.clear()
low.data.materials.append(mat)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 4
bk = sc.render.bake
bk.use_pass_direct = bk.use_pass_indirect = False
bk.use_pass_color = True
bk.use_selected_to_active = True
bk.cage_extrusion = size * 0.01
bk.max_ray_distance = size * 0.04
bk.margin = 6
bpy.ops.object.select_all(action='DESELECT')
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type='DIFFUSE')
bpy.data.objects.remove(high, do_unlink=True)
obj = low

# 原点：底面中心（Blender 里 Z 朝上，导出 glTF 后是 +Y 朝上）
mn = Vector((min(v.co.x for v in obj.data.vertices), min(v.co.y for v in obj.data.vertices), min(v.co.z for v in obj.data.vertices)))
mx = Vector((max(v.co.x for v in obj.data.vertices), max(v.co.y for v in obj.data.vertices), max(v.co.z for v in obj.data.vertices)))
shift = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for v in obj.data.vertices:
    v.co -= shift

img.file_format = 'JPEG'
bpy.ops.export_scene.gltf(filepath=a.out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85)
print(f'[prop] {before} → {tris(obj)} 面，尺寸 {[round(x, 3) for x in (mx - mn)]}，导出 {a.out}')
