import trimesh, glob, sys, os
d = sys.argv[1]
bad = 0
for f in sorted(glob.glob(d + '/**/*.3mf', recursive=True)):
    sc = trimesh.load(f)
    geoms = list(sc.geometry.values()) if hasattr(sc, 'geometry') else [sc]
    b = sc.bounds
    nonwt = 0
    for g in geoms:
        for part in g.split(only_watertight=False):
            if not part.is_watertight or part.volume <= 0: nonwt += 1
    inbed = b[0][0] >= -0.01 and b[0][1] >= -0.01 and b[1][0] <= 250.01 and b[1][1] <= 210.01 and b[0][2] >= -0.01
    if nonwt or not inbed: bad += 1
    print(os.path.relpath(f, d), 'objs', len(geoms), 'bounds', b.round(1).tolist(), 'non-watertight', nonwt, 'in-bed', inbed)
print('BAD', bad)
