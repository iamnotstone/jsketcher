import {TrimmedCurve} from '../../../brep/geom/curve'
import {ApproxCurve} from '../../../brep/geom/impl/approx'
import {Point} from '../../../brep/geom/point'
import {Line} from '../../../brep/geom/impl/Line'
import {LUT} from '../../../math/bezier-cubic'

const RESOLUTION = 20;

class SketchPrimitive {
  constructor(id) {
    this.id = id;
    this.inverted = false;
  }
  
  invert() {
    this.inverted = !this.inverted;
  }

  approximate(resolution) {
    const approximation = this.approximateImpl(resolution);
    if (this.inverted) {
      approximation.reverse();
    }
    return approximation;
  }
}

export class Segment extends SketchPrimitive {
  constructor(id, a, b) {
    super(id);
    this.a = a;
    this.b = b;
  }
  
  approximateImpl(resolution) {
    return [this.a, this.b];
  }
}

export class Arc extends SketchPrimitive {
  constructor(id, a, b, c) {
    super(id);
    this.a = a;
    this.b = b;
    this.c = c;
  }

  approximateImpl(resolution) {
    return Arc.approximateArc(this.a, this.b, this.c, resolution);
  }
  
  static approximateArc(ao, bo, c, resolution) {
    var a = ao.minus(c);
    var b = bo.minus(c);
    var points = [ao];
    var abAngle = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x);
    if (abAngle > Math.PI * 2) abAngle = Math.PI / 2 - abAngle;
    if (abAngle < 0) abAngle = Math.PI * 2 + abAngle;
  
    var r = a.length();
    resolution = 1;
    //var step = Math.acos(1 - ((resolution * resolution) / (2 * r * r)));
    var step = resolution / (2 * Math.PI);
    var k = Math.round(abAngle / step);
    var angle = Math.atan2(a.y, a.x) + step;
  
    for (var i = 0; i < k - 1; ++i) {
      points.push(new Point(c.x + r*Math.cos(angle), c.y + r*Math.sin(angle)));
      angle += step;
    }
    points.push(bo);
    return points;
  }
}

export class BezierCurve extends SketchPrimitive {
  constructor(id, a, b, cp1, cp2) {
    super(id);
    this.a = a;
    this.b = b;
    this.cp1 = cp1;
    this.cp2 = cp2;
  }

  approximateImpl(resolution) {
    return LUT(this.a, this.b, this.cp1, this.cp2, 10);
  }
}

export class EllipticalArc extends SketchPrimitive {
  constructor(id, ep1, ep2, a, b, r) {
    super(id);
    this.ep1 = ep1;
    this.ep2 = ep2;
    this.a = a;
    this.b = b;
    this.r = r;
  }

  approximateImpl(resolution) {
    return EllipticalArc.approxEllipticalArc(this.ep1, this.ep2, this.a, this.b, this.r, resolution);
  }

  static approxEllipticalArc(ep1, ep2, ao, bo, radiusY, resolution) {
    const axisX = ep2.minus(ep1);
    const radiusX = axisX.length() * 0.5;
    axisX._normalize();
    const c = ep1.plus(axisX.multiply(radiusX));
    const a = ao.minus(c);
    const b = bo.minus(c);
    const points = [ao];
    const rotation = Math.atan2(axisX.y, axisX.x);
    let abAngle = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x);
    if (abAngle > Math.PI * 2) abAngle = Math.PI / 2 - abAngle;
    if (abAngle < 0) abAngle = Math.PI * 2 + abAngle;
  
    const sq = (a) => a * a;
  
    resolution = 1;
  
    const step = resolution / (2 * Math.PI);
    const k = Math.round(abAngle / step);
    let angle = Math.atan2(a.y, a.x) + step - rotation;
  
    for (let i = 0; i < k - 1; ++i) {
      const r = Math.sqrt(1/( sq(Math.cos(angle)/radiusX) + sq(Math.sin(angle)/radiusY)));
      points.push(new Point(c.x + r*Math.cos(angle + rotation), c.y + r*Math.sin(angle + rotation)));
      angle += step;
    }
    points.push(bo);
    return points;
  }
  
}

export class Circle extends SketchPrimitive {
  constructor(id, c, r) {
    super(id);
    this.c = c;
    this.r = r;
  }

  approximateImpl(resolution) {
    return Circle.approxCircle(this.c, this.r, resolution);
  }

  static approxCircle(c, r, resolution) {
    var points = [];
    resolution = 1;
    //var step = Math.acos(1 - ((resolution * resolution) / (2 * r * r)));
    var step = resolution / (2 * Math.PI);
    var k = Math.round((2 * Math.PI) / step);

    for (var i = 0, angle = 0; i < k; ++i, angle += step) {
      points.push(new Point(c.x + r*Math.cos(angle), c.y + r*Math.sin(angle)));
    }
    return points;
  }
}

export class Ellipse extends SketchPrimitive {
  constructor(id, ep1, ep2, r) {
    super(id);
    this.ep1 = ep1;
    this.ep2 = ep2;
    this.r = r;
  }

  approximateImpl(resolution) {
    return EllipticalArc.approxEllipticalArc(this.ep1, this.ep2, this.ep1, this.ep1, this.r, resolution);
  }
}

export class Contour {

  constructor() {
    this.segments = [];
  }

  add(obj) {
    this.segments.push(obj);
  }
  
  transferOnSurface(surface, approxTr, pointTr) {
    const edges = [];
    
    const _3dTransformation = surface.get3DTransformation();
    const depth = surface.w;
    function tr(v) {
      if (pointTr) {
        v = pointTr(v);
      }
      v.z = depth;
      return _3dTransformation._apply(v);
    }
    
    for (let segment of this.segments) {
      let approximation = segment.approximate(RESOLUTION);
      
      if (approxTr) {
        approximation = approxTr(approximation);
      }
      approximation = approximation.map(p => tr(p));
      
      const n = approximation.length;
      if (segment instanceof Arc) {
        edges.push(new TrimmedCurve(approximation[0], approximation[n - 1], new ApproxCurve(approximation, segment)));
      } else {  
        
        for (let i = 1; i < n; ++i) {
          edges.push(new TrimmedCurve(approximation[i-1], approximation[i], new Line.fromSegment(approximation[i-1], approximation[i]), segment));
        }
      }
    }
    return edges;
  }
  
  approximate(resolution) {
    const approximation = [];
    for (let segment of this.segments) {
      const segmentApproximation = segment.approximate(resolution);
      segmentApproximation.forEach(sa => approximation.push(sa));
    }
    return approximation;
  }

  reverse() {
    this.segments.reverse();
    this.segments.forEach(s => s.invert());
  }
}
