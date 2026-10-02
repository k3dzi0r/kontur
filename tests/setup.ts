import { initManifold } from '../src/mesh/manifold';
import { setGeometryKernel } from '../src/geometry/clip';

setGeometryKernel(await initManifold());
