import * as THREE from 'three';

// Partition static geometry after computing smooth normals. Keeping the source
// attributes prevents lighting seams at cell borders; no triangles are simplified.
export function spatialChunks(source, cellSize = 16) {
  if (!source.index || source.index.count < 6000) {
    source.computeBoundingSphere();
    return [source];
  }
  const positions = source.getAttribute('position'), index = source.index.array;
  const cells = new Map(), attributes = Object.entries(source.attributes);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    const x = (positions.getX(a) + positions.getX(b) + positions.getX(c)) / 3;
    const y = (positions.getY(a) + positions.getY(b) + positions.getY(c)) / 3;
    const z = (positions.getZ(a) + positions.getZ(b) + positions.getZ(c)) / 3;
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / (cellSize / 2))},${Math.floor(z / cellSize)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { vertices: new Map(), indices: [], data: attributes.map(() => []) };
      cells.set(key, cell);
    }
    for (const vertex of [a, b, c]) {
      let local = cell.vertices.get(vertex);
      if (local === undefined) {
        local = cell.vertices.size; cell.vertices.set(vertex, local);
        attributes.forEach(([, attr], j) => {
          for (let k = 0; k < attr.itemSize; k++) cell.data[j].push(attr.array[vertex * attr.itemSize + k]);
        });
      }
      cell.indices.push(local);
    }
  }
  const chunks = [];
  for (const cell of cells.values()) {
    const geometry = new THREE.BufferGeometry();
    attributes.forEach(([name, attr], j) => geometry.setAttribute(name, new THREE.BufferAttribute(new attr.array.constructor(cell.data[j]), attr.itemSize, attr.normalized)));
    geometry.setIndex(cell.indices);
    geometry.computeBoundingSphere();
    chunks.push(geometry);
  }
  source.dispose();
  return chunks;
}
