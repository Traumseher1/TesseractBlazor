// wwwroot/tesseract.js
// Renders a rotating 4D hypercube (tesseract) onto a 2D canvas.
// Pipeline: 4D rotate -> 4D->3D perspective (via W) -> 3D->2D perspective (via Z) -> draw edges.

(function () {
    /** @type {number | null} */
    let rafId = null;

    /** @type {HTMLCanvasElement | null} */
    let canvas = null;

    /** @type {CanvasRenderingContext2D | null} */
    let ctx = null;

    // "time" parameter (radians-ish scale)
    let t = 0;

    // Speed multiplier controlled from Blazor
    // 1.0 = normal, 2.0 = double speed, 0.5 = half speed
    let speed = 1.0;

    // Timestamp for framerate-independent animation
    /** @type {number | null} */
    let lastTs = null;

    // 16 vertices in 4D: all combinations of ±1 in (x,y,z,w)
    const vertices4 = [];
    for (let i = 0; i < 16; i++) {
        const x = (i & 1) ? 1 : -1;
        const y = (i & 2) ? 1 : -1;
        const z = (i & 4) ? 1 : -1;
        const w = (i & 8) ? 1 : -1;
        vertices4.push([x, y, z, w]);
    }

    // Edges: connect vertices that differ in exactly one coordinate (Hamming distance 1)
    const edges = [];
    for (let a = 0; a < 16; a++) {
        for (let b = a + 1; b < 16; b++) {
            const va = vertices4[a], vb = vertices4[b];
            let diff = 0;
            if (va[0] !== vb[0]) diff++;
            if (va[1] !== vb[1]) diff++;
            if (va[2] !== vb[2]) diff++;
            if (va[3] !== vb[3]) diff++;
            if (diff === 1) edges.push([a, b]);
        }
    }

    function rotatePlane(p, i, j, angle) {
        // Rotates point p in the plane spanned by axes i and j (indices 0..3).
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const pi = p[i], pj = p[j];
        p[i] = pi * c - pj * s;
        p[j] = pi * s + pj * c;
    }

    function project4Dto3D(v4, wDist) {
        // Perspective projection from 4D to 3D using W as depth.
        // scale = wDist / (wDist - w)
        const [x, y, z, w] = v4;
        const denom = (wDist - w);
        const scale = wDist / denom;
        return [x * scale, y * scale, z * scale];
    }

    function project3Dto2D(v3, zDist) {
        // Perspective projection from 3D to 2D using Z as depth.
        const [x, y, z] = v3;
        const denom = (zDist - z);
        const scale = zDist / denom;
        return [x * scale, y * scale, z]; // keep z for styling
    }

    function resizeToDisplaySize() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    function clear(bg) {
        if (!ctx || !canvas) return;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function draw(ts) {
        if (!ctx || !canvas) return;

        // --- Framerate-independent timing ---
        if (lastTs === null) lastTs = ts;
        let dt = (ts - lastTs) / 1000.0; // seconds
        lastTs = ts;

        // Clamp dt so tab-switch / lags don't cause huge jumps
        dt = Math.min(dt, 0.05); // max 50ms step

        // Advance "t" with speed factor
        t += dt * speed;

        resizeToDisplaySize();

        // Theme-ish colors
        const bg = "#0b1020";
        const fg = "#c7d2fe";
        const fgDim = "rgba(199, 210, 254, 0.30)";

        clear(bg);

        const cx = canvas.width / 2;
        const cy = canvas.height / 2;

        // Controls
        const scale2D = Math.min(canvas.width, canvas.height) * 0.22;
        const wDist = 4.0; // larger => less distortion
        const zDist = 4.0;

        // Copy vertices and rotate in multiple 4D planes
        const verts2 = new Array(16);
        for (let i = 0; i < 16; i++) {
            const p = vertices4[i].slice(); // [x,y,z,w]

            // 4D rotations
            rotatePlane(p, 0, 3, t * 0.7);  // x-w
            rotatePlane(p, 1, 3, t * 0.5);  // y-w
            rotatePlane(p, 2, 3, t * 0.3);  // z-w

            // Also rotate in 3D planes for richer motion
            rotatePlane(p, 0, 1, t * 0.4);  // x-y
            rotatePlane(p, 1, 2, t * 0.35); // y-z

            // Project 4D -> 3D -> 2D
            const v3 = project4Dto3D(p, wDist);
            const v2 = project3Dto2D(v3, zDist);

            // Map to screen
            const x2 = cx + v2[0] * scale2D;
            const y2 = cy - v2[1] * scale2D;

            verts2[i] = { x: x2, y: y2, z: v2[2] };
        }

        // Sort edges by average z (painter's algorithm)
        const edgesSorted = edges.slice().sort((e1, e2) => {
            const a1 = (verts2[e1[0]].z + verts2[e1[1]].z) * 0.5;
            const a2 = (verts2[e2[0]].z + verts2[e2[1]].z) * 0.5;
            return a1 - a2;
        });

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Draw edges
        for (const [a, b] of edgesSorted) {
            const pa = verts2[a];
            const pb = verts2[b];
            const avgZ = (pa.z + pb.z) * 0.5;

            // Thickness based on depth (simple heuristic)
            const thickness = 1.0 + (avgZ + 2.0) * 0.7;

            ctx.strokeStyle = avgZ > 0 ? fg : fgDim;
            ctx.lineWidth = thickness;

            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
        }

        // Draw vertices
        for (const p of verts2) {
            const r = 2.2 + (p.z + 2.0) * 0.5;
            ctx.fillStyle = fg;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(1.2, r), 0, Math.PI * 2);
            ctx.fill();
        }

        rafId = requestAnimationFrame(draw);
    }

    function resetTiming() {
        // Resets time base so animation restarts smoothly.
        t = 0;
        lastTs = null;
    }

    window.tesseractRenderer = {
        start: function (canvasId) {
            canvas = document.getElementById(canvasId);
            if (!canvas) return;

            ctx = canvas.getContext("2d", { alpha: false });
            if (!ctx) return;

            if (rafId !== null) cancelAnimationFrame(rafId);
            resetTiming();

            rafId = requestAnimationFrame(draw);
        },

        stop: function () {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = null;
            canvas = null;
            ctx = null;
            lastTs = null;
        },

        setSpeed: function (value) {
            // value: number, expected range e.g. 0..5
            const v = Number(value);
            if (!Number.isFinite(v)) return;

            // Clamp to sensible range
            speed = Math.max(0.0, Math.min(10.0, v));
        }
    };
})();
