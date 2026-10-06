"""把 Tripo 从画作生成的「浮雕板」GLB 处理成适合 Jupiter 相框的人物模型。

Tripo 用一张画（比如穆夏《一日四时》）生成模型时，常常得到一整块浮雕板：人物从画板上凸出来，
画框、背景、签名也都在板上，几百万面，贴图被切成几百块碎片。这个脚本：

  1. 只保留比画板平面凸出 cutoff 以上的部分（人物），去掉零碎小块；
  2. 减面到 faces 面以内（Jupiter 每帧画 9 个视点，整盒每视点建议 ≤ 3 万面）；
  3. 给低模重新展 UV，把高模的颜色烘焙到一张只属于人物的干净贴图上：
     同样 1024 像素，人物分到的像素是原贴图的好几倍，也没有碎片接缝渗色；
  4. 对贴图做轻微柔化：细线和高对比纹理在透镜屏上会串扰发"花"；
  5. 只保留颜色贴图（盒子里用 Lambert，不读法线 / 粗糙度贴图），导出 GLB。

前后厚度不在这里放大，留给引擎按需调（mucha.js 的 depthGain），烘焙时高低模必须对齐。

用法（Blender 4.2+，在 Jupitermusic/ 下）：
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/jupiter_relief.py -- \
      <输入.glb> <输出.glb> [--faces 10000] [--tex 1024] [--blur 0.8] [--cutoff 0.01] [--zmax 0.8]
      盒子式模型（前面一层窗框、后面一块背板、人物夹在中间）加 --between YMIN YMAX --xmax X

zmax：高于这个高度（模型单位，原模型约 0~0.98）的东西一律删掉，用来去掉画框顶上的残片；按人物头顶位置调。
"""
import sys
import argparse
import bpy
import bmesh
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('out')
ap.add_argument('--faces', type=int, default=10000)
ap.add_argument('--tex', type=int, default=1024)
ap.add_argument('--blur', type=float, default=0.8, help='柔化半径（像素，按 tex 尺寸）')
ap.add_argument('--cutoff', type=float, default=0.01, help='比画板平面凸出多少才算人物（模型单位）')
ap.add_argument('--zmax', type=float, default=0.8)
ap.add_argument('--between', type=float, nargs=2, metavar=('YMIN', 'YMAX'), help='盒子式模型（前窗框 + 背板）：只留这个深度区间里的人物，前窗框和背板都去掉')
ap.add_argument('--xmax', type=float, default=9.0, help='只留 |x| 小于这个值的部分（去掉盒子两侧的侧板）')
ap.add_argument('--zmin', type=float, default=-9.0, help='低于这个高度的删掉（去掉底板）')
ap.add_argument('--drop', type=float, nargs=4, action='append', default=[], metavar=('X0', 'X1', 'Z0', 'Z1'), help='删掉这个正面矩形里的东西（和人物连在一起的装饰残片），可重复')
ap.add_argument('--flip', action='store_true', help='人物背对正面时先转 180°（盒子式模型常见：前面是印着正面像的平板，立体人物朝着背板）')
ap.add_argument('--keep', type=float, default=0.03, help='小于最大块这个比例、又几乎贴着画板的零碎块删掉')
ap.add_argument('--relief', type=float, default=0.03, help='小块最高处凸出不到这个值才算碎片；眼睛、眉毛这类凸得高的小块保留')
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.src)
high = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = high
high.select_set(True)
if a.flip:
    high.rotation_euler[2] += 3.14159265
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


# —— 1. 找画板平面：顶点最密的深度层 ——
co = np.empty(len(high.data.vertices) * 3)
high.data.vertices.foreach_get('co', co)
y = co.reshape(-1, 3)[:, 1]
hist, edges = np.histogram(y, bins=200)
plane = (edges[hist.argmax()] + edges[hist.argmax() + 1]) / 2
front = -1 if (y < plane).sum() > (y > plane).sum() else 1  # 人物凸出的方向
print(f'[relief] 画板平面 y={plane:.4f}，人物朝 {"-y" if front < 0 else "+y"}')

if a.between:
    plane, front = a.between[1], -1  # 背板在后，人物朝 -y 凸出
    print(f'[relief] 盒子模式：只留 y ∈ {a.between}')
bm = bmesh.new()
bm.from_mesh(high.data)
for x0, x1, z0, z1 in a.drop:
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if x0 < v.co.x < x1 and z0 < v.co.z < z1], context='VERTS')
if a.between:
    kill = [v for v in bm.verts if not (a.between[0] < v.co.y < a.between[1]) or abs(v.co.x) > a.xmax or v.co.z > a.zmax or v.co.z < a.zmin]
else:
    kill = [v for v in bm.verts if (v.co.y - plane) * front < a.cutoff or abs(v.co.x) > a.xmax or v.co.z > a.zmax or v.co.z < a.zmin]
bmesh.ops.delete(bm, geom=kill, context='VERTS')
seen, islands = set(), []
for v in bm.verts:
    if v in seen:
        continue
    stack, isl = [v], []
    seen.add(v)
    while stack:
        u = stack.pop()
        isl.append(u)
        for e in u.link_edges:
            w = e.other_vert(u)
            if w not in seen:
                seen.add(w)
                stack.append(w)
    islands.append(isl)
islands.sort(key=len, reverse=True)
# 碎片：块小，而且整体几乎贴着画板（芦苇、画框残片）。眼睛、眉毛也是独立小块，但凸得高，要保留
def height(isl):
    return max((u.co.y - plane) * front for u in isl)
small = [v for isl in islands if len(isl) < a.keep * len(islands[0]) and (a.between or height(isl) < a.relief) for v in isl]  # 盒子模式里小块一律删（窗框的金属细弧）
bmesh.ops.delete(bm, geom=small, context='VERTS')
bm.to_mesh(high.data)
bm.free()
print(f'[relief] 切下人物：{tris(high)} 面')

# —— 2. 低模：复制 + 减面 ——
low = high.copy()
low.data = high.data.copy()
low.name = 'jupiter_relief'
bpy.context.collection.objects.link(low)
dec = low.modifiers.new('dec', 'DECIMATE')
dec.ratio = min(1.0, a.faces / max(1, tris(low)))
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = low
low.select_set(True)
bpy.ops.object.modifier_apply(modifier='dec')
bpy.ops.object.shade_smooth()
print(f'[relief] 减面后：{tris(low)} 面')

# —— 3. 正面投影 UV + 烘焙颜色 ——
# 浮雕只从正面看（透镜屏的视角差不到 1°），所以直接按正面投影展 UV：
# 整个人物是一整块，没有接缝；贴图按人物的宽高比开竖长图，像素全用在人物上
while low.data.uv_layers:
    low.data.uv_layers.remove(low.data.uv_layers[0])
uv = low.data.uv_layers.new(name='UVMap')
vco = np.empty(len(low.data.vertices) * 3)
low.data.vertices.foreach_get('co', vco)
vco = vco.reshape(-1, 3)
x0, x1 = vco[:, 0].min(), vco[:, 0].max()
z0, z1 = vco[:, 2].min(), vco[:, 2].max()
vidx = np.empty(len(low.data.loops), dtype=np.int64)
low.data.loops.foreach_get('vertex_index', vidx)
pad = 0.01
u = pad + (1 - 2 * pad) * (vco[vidx, 0] - x0) / (x1 - x0)
v = pad + (1 - 2 * pad) * (vco[vidx, 2] - z0) / (z1 - z0)
uv.data.foreach_set('uv', np.stack([u, v], 1).ravel())
TEX_H = a.tex
TEX_W = 1 << int(round(np.log2(a.tex * (x1 - x0) / (z1 - z0))))  # 取最接近的 2 的幂
print(f'[relief] 正面投影 UV，贴图 {TEX_W}×{TEX_H}')

img = bpy.data.images.new('relief_color', TEX_W, TEX_H, alpha=False)
mat = bpy.data.materials.new('relief')
mat.use_nodes = True
nt = mat.node_tree
tex_node = nt.nodes.new('ShaderNodeTexImage')
tex_node.image = img
nt.links.new(tex_node.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
nt.nodes.active = tex_node
low.data.materials.clear()
low.data.materials.append(mat)

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 4
bk = sc.render.bake
bk.use_pass_direct = False
bk.use_pass_indirect = False
bk.use_pass_color = True
bk.use_selected_to_active = True
bk.cage_extrusion = 0.01
bk.max_ray_distance = 0.06
bk.margin = 8
bpy.ops.object.select_all(action='DESELECT')
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type='DIFFUSE')
print('[relief] 烘焙完成')

# —— 4. 轻微柔化（可分离高斯） ——
if a.blur > 0:
    px = np.array(img.pixels[:], dtype=np.float32).reshape(TEX_H, TEX_W, 4)
    r = max(1, int(a.blur * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / a.blur) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        px[..., :3] = np.apply_along_axis(lambda m: np.convolve(np.pad(m, r, mode='edge'), k, mode='valid'), axis, px[..., :3])
    img.pixels[:] = px.ravel()
    print(f'[relief] 柔化半径 {a.blur}px')

# —— 5. 导出：只要低模、只要颜色贴图 ——
bpy.data.objects.remove(high, do_unlink=True)
img.file_format = 'JPEG'
bpy.ops.object.select_all(action='DESELECT')
low.select_set(True)
bpy.ops.export_scene.gltf(filepath=a.out, export_format='GLB', use_selection=True,
                          export_image_format='JPEG', export_jpeg_quality=88)
print(f'[relief] 导出 {a.out}')
