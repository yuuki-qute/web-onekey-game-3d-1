// Game variables
let canvas, gl;
let shaderProgram, ssaoProgram;
let audioContext;
let gameState = {
    life: 100,
    score: 0,
    speed: 0.02,
    playerY: 0,
    playerVelocity: 0,
    gameRunning: false,
    showTitle: true,
    time: 0
};

// Input
let keys = {};

// Geometry buffers
let tunnelBuffer, obstacleBuffers = [];
let playerBuffer;
let obstacles = [];

// Camera and matrices
let viewMatrix, projectionMatrix;
let cameraPos = [0, 0, 0];

// Shader sources
const vertexShaderSource = `
    attribute vec3 a_position;
    attribute vec3 a_normal;
    attribute vec2 a_texCoord;
    
    uniform mat4 u_modelMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_normalMatrix;
    
    varying vec3 v_worldPos;
    varying vec3 v_normal;
    varying vec2 v_texCoord;
    varying vec4 v_clipPos;
    
    void main() {
        vec4 worldPos = u_modelMatrix * vec4(a_position, 1.0);
        v_worldPos = worldPos.xyz;
        v_normal = normalize((u_normalMatrix * vec4(a_normal, 0.0)).xyz);
        v_texCoord = a_texCoord;
        
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        v_clipPos = gl_Position;
    }
`;

const fragmentShaderSource = `
    precision mediump float;
    
    varying vec3 v_worldPos;
    varying vec3 v_normal;
    varying vec2 v_texCoord;
    varying vec4 v_clipPos;
    
    uniform vec3 u_lightDirection;
    uniform vec3 u_cameraPos;
    uniform float u_time;
    uniform int u_materialType; // 0: wall, 1: metal obstacle, 2: wireframe
    
    vec3 geometricPattern(vec2 uv) {
        float scale = 4.0; // Larger scale for more visible checkers
        vec2 p = uv * scale;
        
        // Create checkerboard pattern
        vec2 grid = floor(p);
        float checker = mod(grid.x + grid.y, 2.0);
        
        // Define two colors for the checkerboard
        vec3 color1 = vec3(0.2, 0.3, 0.6); // Dark blue
        vec3 color2 = vec3(0.4, 0.5, 0.8); // Light blue
        
        return mix(color1, color2, checker);
    }
    
    vec3 metalShading(vec3 normal, vec3 viewDir, vec3 lightDir) {
        float NdotL = max(dot(normal, lightDir), 0.0);
        vec3 reflectDir = reflect(-lightDir, normal);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
        
        vec3 baseColor = vec3(0.7, 0.7, 0.8);
        vec3 diffuse = baseColor * NdotL;
        vec3 specular = vec3(1.0) * spec * 0.8;
        
        return diffuse + specular;
    }
    
    void main() {
        vec3 normal = normalize(v_normal);
        vec3 viewDir = normalize(u_cameraPos - v_worldPos);
        vec3 lightDir = normalize(u_lightDirection);
        
        vec3 color;
        
        if (u_materialType == 0) {
            // Wall material with geometric pattern
            color = geometricPattern(v_texCoord);
        } else if (u_materialType == 1) {
            // Metal obstacle material
            color = metalShading(normal, viewDir, lightDir);
        } else if (u_materialType == 2) {
            // Bright green wireframe
            color = vec3(0.2, 1.0, 0.2);
        }
        
        // Basic lighting
        float NdotL = max(dot(normal, lightDir), 0.0);
        vec3 ambient = color * 0.3;
        vec3 diffuse = color * NdotL * 0.7;
        
        // Skip lighting for wireframe - keep it bright
        if (u_materialType == 2) {
            color = color; // Keep original bright color
        } else {
            color = ambient + diffuse;
        }
        
        gl_FragColor = vec4(color, 1.0);
    }
`;

// Initialize WebGL
function initGL() {
    canvas = document.getElementById('gameCanvas');
    gl = canvas.getContext('webgl');
    
    if (!gl) {
        alert('WebGL not supported');
        return false;
    }
    
    // Set canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // モバイルデバイスの向き変更対応
    window.addEventListener('orientationchange', () => {
        // 向き変更後、少し遅延してリサイズを実行
        setTimeout(resizeCanvas, 100);
    });
    
    // デバイスピクセル比の変更対応（外部モニター接続時など）
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(resolution: 1dppx)');
        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', resizeCanvas);
        } else {
            // 古いブラウザ対応
            mediaQuery.addListener(resizeCanvas);
        }
    }
    
    // Enable depth testing
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    
    return true;
}

// Initialize Audio Context
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        return true;
    } catch (error) {
        console.warn('Web Audio API not supported:', error);
        return false;
    }
}

// Play collision sound effect
function playCollisionSound(type = 'obstacle') {
    if (!audioContext) return;
    
    // Resume audio context if suspended (required for autoplay policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'obstacle') {
        // Higher pitched, shorter sound for obstacles
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
        oscillator.type = 'square';
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    } else if (type === 'wall') {
        // Lower pitched, slightly longer sound for walls
        oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.15);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15);
        oscillator.type = 'sawtooth';
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);
    }
}

// Play melody for game events
function playMelody(type = 'start') {
    if (!audioContext) return;
    
    // Resume audio context if suspended
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    let notes = [];
    let noteDuration = 0.2;
    let baseVolume = 0.15;
    
    if (type === 'start') {
        // Uplifting start melody: C-E-G-C (major chord progression)
        notes = [
            { freq: 523.25, duration: 0.15 }, // C5
            { freq: 659.25, duration: 0.15 }, // E5
            { freq: 783.99, duration: 0.15 }, // G5
            { freq: 1046.50, duration: 0.3 }  // C6 (longer)
        ];
    } else if (type === 'gameOver') {
        // Descending game over melody: G-F-E-D-C
        notes = [
            { freq: 783.99, duration: 0.2 }, // G5
            { freq: 698.46, duration: 0.2 }, // F5
            { freq: 659.25, duration: 0.2 }, // E5
            { freq: 587.33, duration: 0.2 }, // D5
            { freq: 523.25, duration: 0.4 }  // C5 (longer)
        ];
        baseVolume = 0.12; // Slightly quieter for game over
    }
    
    let currentTime = audioContext.currentTime;
    
    notes.forEach((note, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(note.freq, currentTime);
        oscillator.type = 'square';
        
        // Envelope: attack, sustain, release
        gainNode.gain.setValueAtTime(0, currentTime);
        gainNode.gain.linearRampToValueAtTime(baseVolume, currentTime + 0.02); // Quick attack
        gainNode.gain.setValueAtTime(baseVolume * 0.8, currentTime + note.duration * 0.7); // Sustain
        gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + note.duration); // Release
        
        oscillator.start(currentTime);
        oscillator.stop(currentTime + note.duration);
        
        currentTime += note.duration;
    });
}

function resizeCanvas() {
    // デバイスピクセル比を取得（Retina等の高解像度ディスプレイ対応）
    const devicePixelRatio = window.devicePixelRatio || 1;
    
    // 表示サイズ（CSS pixels）
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;
    
    // 実際の描画解像度（device pixels）
    const drawingBufferWidth = Math.floor(displayWidth * devicePixelRatio);
    const drawingBufferHeight = Math.floor(displayHeight * devicePixelRatio);
    
    // Canvasの表示サイズを設定（CSS）
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    
    // Canvasの描画バッファサイズを設定（実際の解像度）
    if (canvas.width !== drawingBufferWidth || canvas.height !== drawingBufferHeight) {
        canvas.width = drawingBufferWidth;
        canvas.height = drawingBufferHeight;
        
        // WebGLビューポートを更新
        gl.viewport(0, 0, canvas.width, canvas.height);
        
        console.log(`Canvas resized: Display ${displayWidth}x${displayHeight}, Buffer ${drawingBufferWidth}x${drawingBufferHeight}, DPR: ${devicePixelRatio}`);
    }
}

// Shader utilities
function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    
    return shader;
}

function createProgram(vertexSource, fragmentSource) {
    const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        return null;
    }
    
    return program;
}

// Matrix utilities
function createMatrix4() {
    return new Float32Array(16);
}

function identity(out) {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
}

function perspective(out, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = (2 * far * near) * nf; out[15] = 0;
    return out;
}

function lookAt(out, eye, center, up) {
    const x0 = eye[0], x1 = eye[1], x2 = eye[2];
    const y0 = center[0], y1 = center[1], y2 = center[2];
    const z0 = up[0], z1 = up[1], z2 = up[2];
    
    if (Math.abs(x0 - y0) < 0.000001 &&
        Math.abs(x1 - y1) < 0.000001 &&
        Math.abs(x2 - y2) < 0.000001) {
        return identity(out);
    }
    
    let z0f = x0 - y0, z1f = x1 - y1, z2f = x2 - y2;
    let len = 1 / Math.hypot(z0f, z1f, z2f);
    z0f *= len; z1f *= len; z2f *= len;
    
    let x0f = z1 * z2f - z2 * z1f;
    let x1f = z2 * z0f - z0 * z2f;
    let x2f = z0 * z1f - z1 * z0f;
    len = Math.hypot(x0f, x1f, x2f);
    if (!len) {
        x0f = 0; x1f = 0; x2f = 0;
    } else {
        len = 1 / len;
        x0f *= len; x1f *= len; x2f *= len;
    }
    
    let y0f = z1f * x2f - z2f * x1f;
    let y1f = z2f * x0f - z0f * x2f;
    let y2f = z0f * x1f - z1f * x0f;
    
    out[0] = x0f; out[1] = y0f; out[2] = z0f; out[3] = 0;
    out[4] = x1f; out[5] = y1f; out[6] = z1f; out[7] = 0;
    out[8] = x2f; out[9] = y2f; out[10] = z2f; out[11] = 0;
    out[12] = -(x0f * x0 + x1f * x1 + x2f * x2);
    out[13] = -(y0f * x0 + y1f * x1 + y2f * x2);
    out[14] = -(z0f * x0 + z1f * x1 + z2f * x2);
    out[15] = 1;
    
    return out;
}

function translate(out, a, v) {
    const x = v[0], y = v[1], z = v[2];
    if (a === out) {
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    } else {
        for (let i = 0; i < 12; i++) out[i] = a[i];
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    }
    return out;
}

function scale(out, a, v) {
    const x = v[0], y = v[1], z = v[2];
    out[0] = a[0] * x; out[1] = a[1] * x; out[2] = a[2] * x; out[3] = a[3] * x;
    out[4] = a[4] * y; out[5] = a[5] * y; out[6] = a[6] * y; out[7] = a[7] * y;
    out[8] = a[8] * z; out[9] = a[9] * z; out[10] = a[10] * z; out[11] = a[11] * z;
    out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
    return out;
}

function rotateX(out, a, rad) {
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    
    if (a !== out) {
        out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3];
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
    }
    
    out[4] = a10 * c + a20 * s;
    out[5] = a11 * c + a21 * s;
    out[6] = a12 * c + a22 * s;
    out[7] = a13 * c + a23 * s;
    out[8] = a20 * c - a10 * s;
    out[9] = a21 * c - a11 * s;
    out[10] = a22 * c - a12 * s;
    out[11] = a23 * c - a13 * s;
    return out;
}

function rotateY(out, a, rad) {
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    
    if (a !== out) {
        out[4] = a[4]; out[5] = a[5]; out[6] = a[6]; out[7] = a[7];
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
    }
    
    out[0] = a00 * c - a20 * s;
    out[1] = a01 * c - a21 * s;
    out[2] = a02 * c - a22 * s;
    out[3] = a03 * c - a23 * s;
    out[8] = a00 * s + a20 * c;
    out[9] = a01 * s + a21 * c;
    out[10] = a02 * s + a22 * c;
    out[11] = a03 * s + a23 * c;
    return out;
}

function rotateZ(out, a, rad) {
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    
    if (a !== out) {
        out[8] = a[8]; out[9] = a[9]; out[10] = a[10]; out[11] = a[11];
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
    }
    
    out[0] = a00 * c + a10 * s;
    out[1] = a01 * c + a11 * s;
    out[2] = a02 * c + a12 * s;
    out[3] = a03 * c + a13 * s;
    out[4] = a10 * c - a00 * s;
    out[5] = a11 * c - a01 * s;
    out[6] = a12 * c - a02 * s;
    out[7] = a13 * c - a03 * s;
    return out;
}

// Create tunnel geometry
function createTunnel() {
    const segments = 100;
    const radius = 2;
    const length = 50;
    
    const positions = [];
    const normals = [];
    const texCoords = [];
    const indices = [];
    
    // Create tunnel walls
    for (let i = 0; i <= segments; i++) {
        const z = (i / segments) * length;
        
        // Top wall
        positions.push(-radius, radius, z);
        positions.push(radius, radius, z);
        normals.push(0, -1, 0);
        normals.push(0, -1, 0);
        texCoords.push(0, z / 5);
        texCoords.push(1, z / 5);
        
        // Bottom wall
        positions.push(-radius, -radius, z);
        positions.push(radius, -radius, z);
        normals.push(0, 1, 0);
        normals.push(0, 1, 0);
        texCoords.push(0, z / 5);
        texCoords.push(1, z / 5);
        
        // Left wall
        positions.push(-radius, -radius, z);
        positions.push(-radius, radius, z);
        normals.push(1, 0, 0);
        normals.push(1, 0, 0);
        texCoords.push(0, z / 5);
        texCoords.push(1, z / 5);
        
        // Right wall
        positions.push(radius, -radius, z);
        positions.push(radius, radius, z);
        normals.push(-1, 0, 0);
        normals.push(-1, 0, 0);
        texCoords.push(0, z / 5);
        texCoords.push(1, z / 5);
    }
    
    // Create indices for triangle strips
    for (let i = 0; i < segments; i++) {
        const base = i * 8;
        
        // Top wall
        indices.push(base, base + 1, base + 8);
        indices.push(base + 1, base + 9, base + 8);
        
        // Bottom wall
        indices.push(base + 2, base + 10, base + 3);
        indices.push(base + 3, base + 10, base + 11);
        
        // Left wall
        indices.push(base + 4, base + 5, base + 12);
        indices.push(base + 5, base + 13, base + 12);
        
        // Right wall
        indices.push(base + 6, base + 14, base + 7);
        indices.push(base + 7, base + 14, base + 15);
    }
    
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
    
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    
    return {
        position: positionBuffer,
        normal: normalBuffer,
        texCoord: texCoordBuffer,
        indices: indexBuffer,
        indexCount: indices.length
    };
}

// Create polyhedron obstacles
function createIcosahedron() {
    const t = (1.0 + Math.sqrt(5.0)) / 2.0;
    
    const positions = [
        -1, t, 0,  1, t, 0,  -1, -t, 0,  1, -t, 0,
        0, -1, t,  0, 1, t,  0, -1, -t,  0, 1, -t,
        t, 0, -1,  t, 0, 1,  -t, 0, -1,  -t, 0, 1
    ];
    
    const indices = [
        0, 11, 5,  0, 5, 1,  0, 1, 7,  0, 7, 10,  0, 10, 11,
        1, 5, 9,  5, 11, 4,  11, 10, 2,  10, 7, 6,  7, 1, 8,
        3, 9, 4,  3, 4, 2,  3, 2, 6,  3, 6, 8,  3, 8, 9,
        4, 9, 5,  2, 4, 11,  6, 2, 10,  8, 6, 7,  9, 8, 1
    ];
    
    // Calculate flat normals (per-face)
    const normals = [];
    for (let i = 0; i < indices.length; i += 3) {
        const i1 = indices[i] * 3;
        const i2 = indices[i + 1] * 3;
        const i3 = indices[i + 2] * 3;
        
        // Get triangle vertices
        const v1 = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
        const v2 = [positions[i2], positions[i2 + 1], positions[i2 + 2]];
        const v3 = [positions[i3], positions[i3 + 1], positions[i3 + 2]];
        
        // Calculate face normal using cross product
        const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
        const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
        
        const normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0]
        ];
        
        // Normalize
        const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
        if (length > 0) {
            normal[0] /= length;
            normal[1] /= length;
            normal[2] /= length;
        }
        
        // Add same normal for all three vertices of the triangle
        normals.push(normal[0], normal[1], normal[2]);
        normals.push(normal[0], normal[1], normal[2]);
        normals.push(normal[0], normal[1], normal[2]);
    }
    
    // Rebuild positions and texCoords for flat shading
    const flatPositions = [];
    const flatTexCoords = [];
    for (let i = 0; i < indices.length; i++) {
        const vertIndex = indices[i] * 3;
        flatPositions.push(positions[vertIndex], positions[vertIndex + 1], positions[vertIndex + 2]);
        flatTexCoords.push(0.5, 0.5);
    }
    
    // Update indices for flat shading (sequential)
    const flatIndices = [];
    for (let i = 0; i < indices.length; i++) {
        flatIndices.push(i);
    }
    
    // Create wireframe edges by extracting unique edges from triangles
    // Use flatIndices for wireframe to match flat shading vertex data
    const edges = new Set();
    for (let i = 0; i < flatIndices.length; i += 3) {
        const a = flatIndices[i];
        const b = flatIndices[i + 1];
        const c = flatIndices[i + 2];
        
        // Add edges (ensure consistent ordering)
        edges.add(Math.min(a, b) + ',' + Math.max(a, b));
        edges.add(Math.min(b, c) + ',' + Math.max(b, c));
        edges.add(Math.min(c, a) + ',' + Math.max(c, a));
    }
    
    const wireframeIndices = [];
    edges.forEach(edge => {
        const [a, b] = edge.split(',').map(Number);
        wireframeIndices.push(a, b);
    });
    
    const texCoords = flatTexCoords;
    
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flatPositions), gl.STATIC_DRAW);
    
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
    
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(flatIndices), gl.STATIC_DRAW);
    
    const wireframeIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireframeIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(wireframeIndices), gl.STATIC_DRAW);
    
    return {
        position: positionBuffer,
        normal: normalBuffer,
        texCoord: texCoordBuffer,
        indices: indexBuffer,
        indexCount: flatIndices.length,
        wireframeIndices: wireframeIndexBuffer,
        wireframeIndexCount: wireframeIndices.length
    };
}

// Create fighter spacecraft model
function createFighter() {
    const positions = [];
    const normals = [];
    const texCoords = [];
    const indices = [];
    
    // Fighter spacecraft vertices (simplified geometric shape)
    // Main fuselage (elongated diamond shape)
    const vertices = [
        // Front nose (0)
        [0.0, 0.0, 1.2],
        
        // Main body vertices (1-8)
        [0.0, 0.15, 0.6],   // top front (1)
        [0.0, -0.1, 0.6],   // bottom front (2)
        [0.2, 0.0, 0.6],    // right front (3)
        [-0.2, 0.0, 0.6],   // left front (4)
        
        [0.0, 0.1, -0.2],   // top rear (5)
        [0.0, -0.08, -0.2], // bottom rear (6)
        [0.15, 0.0, -0.2],  // right rear (7)
        [-0.15, 0.0, -0.2], // left rear (8)
        
        // Wing tips (9-12)
        [0.6, 0.0, 0.0],    // right wing tip (9)
        [-0.6, 0.0, 0.0],   // left wing tip (10)
        [0.4, 0.0, -0.4],   // right wing rear (11)
        [-0.4, 0.0, -0.4],  // left wing rear (12)
        
        // Engine exhausts (13-14)
        [0.08, 0.0, -0.8],  // right engine (13)
        [-0.08, 0.0, -0.8], // left engine (14)
    ];
    
    // Convert vertices to flat array
    vertices.forEach(v => {
        positions.push(v[0], v[1], v[2]);
        texCoords.push(0.5, 0.5); // Simple UV mapping
    });
    
    // Define triangular faces for the fighter
    const faces = [
        // Nose section
        [0, 1, 3], [0, 3, 2], [0, 2, 4], [0, 4, 1],
        
        // Main fuselage
        [1, 5, 3], [3, 5, 7], [7, 5, 6], [6, 2, 7], [7, 2, 3],
        [2, 6, 4], [4, 6, 8], [8, 6, 5], [5, 1, 8], [8, 1, 4],
        
        // Wings
        [3, 7, 9], [7, 11, 9],
        [4, 10, 8], [8, 10, 12],
        
        // Wing connections
        [7, 13, 11], [8, 12, 14],
        
        // Bottom panels
        [2, 13, 7], [6, 13, 2], [6, 14, 13], [6, 8, 14],
        
        // Engine exhausts
        [13, 14, 6], [5, 13, 6], [5, 14, 13] // Simplified engine area
    ];
    
    // Calculate normals and build final arrays
    faces.forEach(face => {
        const [i1, i2, i3] = face;
        
        // Get vertices
        const v1 = vertices[i1];
        const v2 = vertices[i2];
        const v3 = vertices[i3];
        
        // Calculate face normal
        const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
        const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
        
        const normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0]
        ];
        
        // Normalize
        const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
        if (length > 0) {
            normal[0] /= length;
            normal[1] /= length;
            normal[2] /= length;
        }
        
        // Add vertices and normals for this face
        const baseIndex = indices.length;
        
        [v1, v2, v3].forEach(v => {
            positions.push(v[0], v[1], v[2]);
            normals.push(normal[0], normal[1], normal[2]);
            texCoords.push(0.5, 0.5);
        });
        
        indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    });
    
    // Create wireframe edges
    const edges = new Set();
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i];
        const b = indices[i + 1];
        const c = indices[i + 2];
        
        edges.add(Math.min(a, b) + ',' + Math.max(a, b));
        edges.add(Math.min(b, c) + ',' + Math.max(b, c));
        edges.add(Math.min(c, a) + ',' + Math.max(c, a));
    }
    
    const wireframeIndices = [];
    edges.forEach(edge => {
        const [a, b] = edge.split(',').map(Number);
        wireframeIndices.push(a, b);
    });
    
    // Create buffers
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
    
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    
    const wireframeIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireframeIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(wireframeIndices), gl.STATIC_DRAW);
    
    return {
        position: positionBuffer,
        normal: normalBuffer,
        texCoord: texCoordBuffer,
        indices: indexBuffer,
        indexCount: indices.length,
        wireframeIndices: wireframeIndexBuffer,
        wireframeIndexCount: wireframeIndices.length
    };
}

// Input handling
function setupInput() {
    document.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'Space') {
            e.preventDefault();
            if (gameState.showTitle) {
                startGame();
            }
        }
    });
    
    document.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });
    
    // Mouse input
    document.addEventListener('mousedown', (e) => {
        e.preventDefault();
        
        // Check if click is on fullscreen button
        if (e.target.id === 'fullscreenBtn') {
            return; // Don't start game if fullscreen button was clicked
        }
        
        keys['MouseClick'] = true;
        if (gameState.showTitle) {
            startGame();
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        e.preventDefault();
        keys['MouseClick'] = false;
    });
    
    // Touch input for mobile devices
    document.addEventListener('touchstart', (e) => {
        e.preventDefault();
        
        // Check if touch is on fullscreen button
        if (e.target.id === 'fullscreenBtn') {
            return; // Don't start game if fullscreen button was touched
        }
        
        keys['Touch'] = true;
        if (gameState.showTitle) {
            startGame();
        }
    });
    
    document.addEventListener('touchend', (e) => {
        e.preventDefault();
        keys['Touch'] = false;
    });
    
    document.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        keys['Touch'] = false;
    });
    
    // モバイルブラウザでのコンテキストメニュー抑制
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });
    
    // 長押しコンテキストメニュー抑制
    document.addEventListener('selectstart', (e) => {
        e.preventDefault();
        return false;
    });
    
    // iOS Safariでの長押しメニュー抑制
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // Android Chromeでの長押しメニュー抑制
    let touchTimeout;
    document.addEventListener('touchstart', (e) => {
        touchTimeout = setTimeout(() => {
            // 長押し時の処理をキャンセル
        }, 500);
    });
    
    document.addEventListener('touchend', (e) => {
        if (touchTimeout) {
            clearTimeout(touchTimeout);
        }
    });
    
    document.addEventListener('touchmove', (e) => {
        if (touchTimeout) {
            clearTimeout(touchTimeout);
        }
    });
}

// Calculate difficulty multiplier based on score
function getDifficultyMultiplier() {
    const progressFactor = gameState.score / 1000;
    return 1 + progressFactor;
}

// Game logic
function updateGame(deltaTime) {
    if (gameState.showTitle) {
        // Show title screen, wait for input to start
        showTitleScreen();
        return;
    }
    
    if (!gameState.gameRunning) return;
    
    gameState.time += deltaTime;
    
    // Player movement
    if (keys['Space'] || keys['Touch'] || keys['MouseClick']) {
        gameState.playerVelocity += 0.002 * (deltaTime / 16.67); // Normalize to 60fps
    } else {
        gameState.playerVelocity -= 0.002 * (deltaTime / 16.67); // Normalize to 60fps
    }
    
	gameState.playerVelocity = Math.max(-0.06, Math.min(0.06, gameState.playerVelocity));
    gameState.playerY += gameState.playerVelocity * (deltaTime / 16.67); // Normalize to 60fps
    
    // Wall collision
    if (gameState.playerY > 1.8 || gameState.playerY < -1.8) {
        gameState.life = Math.max(0, gameState.life - 10);
        showDamageFlash();
        playCollisionSound('wall');

        // Bounce effect - reverse velocity with some damping
        if (gameState.playerY > 0) {
            gameState.playerVelocity = -0.06;
        } else {
            gameState.playerVelocity = 0.06;
        }

        // Keep player within bounds
        gameState.playerY = Math.max(-1.8, Math.min(1.8, gameState.playerY));
    }
    
    // Update camera position
    cameraPos[1] = gameState.playerY;
    cameraPos[2] += gameState.speed * (deltaTime / 16.67); // Normalize to 60fps
    
    // Update score
    gameState.score = Math.floor(cameraPos[2] * 10);
    
    // Increase speed over time
    gameState.speed = 0.02 + gameState.time * 0.00001;
    
    // Spawn obstacles with increasing frequency based on progress
    const baseSpawnRate = 0.01;
    const difficultyMultiplier = getDifficultyMultiplier();
    const currentSpawnRate = baseSpawnRate * difficultyMultiplier;
    
    if (Math.random() < currentSpawnRate) {
        obstacles.push({
            x: (Math.random() - 0.5) * 3,
            y: (Math.random() - 0.5) * 3,
            z: cameraPos[2] + 40,
            rotationX: Math.random() * Math.PI * 2,
            rotationY: Math.random() * Math.PI * 2,
            rotationZ: Math.random() * Math.PI * 2,
            rotationSpeedX: (Math.random() - 0.5) * 0.004 * 16,
            rotationSpeedY: (Math.random() - 0.5) * 0.004 * 16,
            rotationSpeedZ: (Math.random() - 0.5) * 0.004 * 16
        });
    }
    
    // Update obstacles
    obstacles.forEach((obstacle, index) => {
        obstacle.rotationX += obstacle.rotationSpeedX * (deltaTime / 16.67); // Normalize to 60fps
        obstacle.rotationY += obstacle.rotationSpeedY * (deltaTime / 16.67); // Normalize to 60fps
        obstacle.rotationZ += obstacle.rotationSpeedZ * (deltaTime / 16.67); // Normalize to 60fps
        
        // Check collision with player
        // Player actual position: [0, gameState.playerY, cameraPos[2] + 0.5]
        const dx = obstacle.x - 0;
        const dy = obstacle.y - gameState.playerY;
        const dz = obstacle.z - (cameraPos[2] + 0.5); // Match player render position
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (distance < 0.5) {
            gameState.life = Math.max(0, gameState.life - 20);
            showDamageFlash();
            playCollisionSound('obstacle');
            obstacles.splice(index, 1);
        }
        
        // Remove obstacles behind camera
        if (obstacle.z < cameraPos[2] - 5) {
            obstacles.splice(index, 1);
        }
    });
    
    // Check game over
    if (gameState.life <= 0) {
        gameState.gameRunning = false;
        showGameOver();
    }
    
    // Update UI
    updateUI();
}

function updateUI() {
    document.getElementById('lifeFill').style.width = gameState.life + '%';
    document.getElementById('score').textContent = gameState.score;
    
    const highScore = parseInt(localStorage.getItem('highScore') || '0');
    document.getElementById('highScore').textContent = highScore;
    
    // Display difficulty using shared calculation
    const difficultyMultiplier = getDifficultyMultiplier();
    document.getElementById('difficulty').textContent = difficultyMultiplier.toFixed(1) + 'x';
    
    // Hide difficulty display on title screen
    const difficultyElement = document.querySelector('.difficulty');
    if (gameState.showTitle) {
        difficultyElement.style.display = 'none';
    } else {
        difficultyElement.style.display = 'block';
    }
}

function showDamageFlash() {
    const flashElement = document.getElementById('damageFlash');
    
    // Apply the flash effect immediately
    flashElement.classList.add('active');
    
    // Remove the effect after a short delay to start the fade out
    setTimeout(() => {
        flashElement.classList.remove('active');
    }, 200);
}

function showGameOver() {
    const highScore = parseInt(localStorage.getItem('highScore') || '0');
    if (gameState.score > highScore) {
        localStorage.setItem('highScore', gameState.score.toString());
    }
    
    // Play game over melody
    playMelody('gameOver');
    
    document.getElementById('finalScore').textContent = gameState.score;
    document.getElementById('finalHighScore').textContent = Math.max(highScore, gameState.score);
    document.getElementById('gameOver').style.display = 'block';
}

function showTitleScreen() {
    const highScore = parseInt(localStorage.getItem('highScore') || '0');
    document.getElementById('titleHighScore').textContent = highScore;
    document.getElementById('titleScreen').style.display = 'block';
    document.getElementById('gameOver').style.display = 'none';
    
    // Hide difficulty display on title screen
    const difficultyElement = document.querySelector('.difficulty');
    difficultyElement.style.display = 'none';
    
    updateFullscreenButton();
}

function startGame() {
    gameState.showTitle = false;
    gameState.gameRunning = true;
    document.getElementById('titleScreen').style.display = 'none';
    
    // Play start melody
    playMelody('start');
    
    // Show difficulty display when game starts
    const difficultyElement = document.querySelector('.difficulty');
    difficultyElement.style.display = 'block';
    
    updateUI();
}

function restartGame() {
    gameState = {
        life: 100,
        score: 0,
        speed: 0.02,
        playerY: 0,
        playerVelocity: 0,
        gameRunning: false,
        showTitle: true,
        time: 0
    };
    
    cameraPos = [0, 0, 0];
    obstacles = [];
    
    document.getElementById('gameOver').style.display = 'none';
    showTitleScreen();
}

// Rendering
function render() {
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    gl.useProgram(shaderProgram);
    
    // Set up matrices
    const aspect = canvas.width / canvas.height;
    projectionMatrix = createMatrix4();
    perspective(projectionMatrix, Math.PI / 2, aspect, 0.1, 100.0);
    
    viewMatrix = createMatrix4();
    lookAt(viewMatrix, cameraPos, [cameraPos[0], cameraPos[1], cameraPos[2] + 1], [0, 1, 0]);
    
    // Set uniforms
    const projectionLoc = gl.getUniformLocation(shaderProgram, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(shaderProgram, 'u_viewMatrix');
    const lightDirLoc = gl.getUniformLocation(shaderProgram, 'u_lightDirection');
    const cameraPosLoc = gl.getUniformLocation(shaderProgram, 'u_cameraPos');
    const timeLoc = gl.getUniformLocation(shaderProgram, 'u_time');
    
    gl.uniformMatrix4fv(projectionLoc, false, projectionMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    gl.uniform3f(lightDirLoc, 0.5, -0.866, -1.0);
    gl.uniform3f(cameraPosLoc, cameraPos[0], cameraPos[1], cameraPos[2]);
    gl.uniform1f(timeLoc, gameState.time);
    
    // Render tunnel
    renderTunnel();
    
    // Render player fighter
    renderPlayer();
    
    // Render obstacles
    renderObstacles();
}

function renderTunnel() {
    const modelLoc = gl.getUniformLocation(shaderProgram, 'u_modelMatrix');
    const normalLoc = gl.getUniformLocation(shaderProgram, 'u_normalMatrix');
    const materialLoc = gl.getUniformLocation(shaderProgram, 'u_materialType');
    
    gl.uniform1i(materialLoc, 0); // Wall material
    
    // Bind tunnel geometry
    const positionLoc = gl.getAttribLocation(shaderProgram, 'a_position');
    const normalLoc2 = gl.getAttribLocation(shaderProgram, 'a_normal');
    const texCoordLoc = gl.getAttribLocation(shaderProgram, 'a_texCoord');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, tunnelBuffer.position);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, tunnelBuffer.normal);
    gl.enableVertexAttribArray(normalLoc2);
    gl.vertexAttribPointer(normalLoc2, 3, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, tunnelBuffer.texCoord);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tunnelBuffer.indices);
    
    // Render multiple tunnel segments to create continuous tunnel
    const tunnelLength = 50; // Length of each tunnel segment
    const currentZ = cameraPos[2];
    const startSegment = Math.floor((currentZ - 25) / tunnelLength);
    const endSegment = startSegment + 3; // Render 3 segments ahead
    
    for (let segment = startSegment; segment <= endSegment; segment++) {
        const modelMatrix = createMatrix4();
        identity(modelMatrix);
        translate(modelMatrix, modelMatrix, [0, 0, segment * tunnelLength - 25]);
        
        gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
        gl.uniformMatrix4fv(normalLoc, false, modelMatrix);
        
        gl.drawElements(gl.TRIANGLES, tunnelBuffer.indexCount, gl.UNSIGNED_SHORT, 0);
    }
}

function renderObstacles() {
    if (obstacleBuffers.length === 0) return;
    
    const modelLoc = gl.getUniformLocation(shaderProgram, 'u_modelMatrix');
    const normalLoc = gl.getUniformLocation(shaderProgram, 'u_normalMatrix');
    const materialLoc = gl.getUniformLocation(shaderProgram, 'u_materialType');
    
    const positionLoc = gl.getAttribLocation(shaderProgram, 'a_position');
    const normalLoc2 = gl.getAttribLocation(shaderProgram, 'a_normal');
    const texCoordLoc = gl.getAttribLocation(shaderProgram, 'a_texCoord');
    
    obstacles.forEach(obstacle => {
        const modelMatrix = createMatrix4();
        identity(modelMatrix);
        translate(modelMatrix, modelMatrix, [obstacle.x, obstacle.y, obstacle.z]);
        rotateX(modelMatrix, modelMatrix, obstacle.rotationX);
        rotateY(modelMatrix, modelMatrix, obstacle.rotationY);
        rotateZ(modelMatrix, modelMatrix, obstacle.rotationZ);
        scale(modelMatrix, modelMatrix, [0.3, 0.3, 0.3]);
        
        gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
        gl.uniformMatrix4fv(normalLoc, false, modelMatrix);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, obstacleBuffers[0].position);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, obstacleBuffers[0].normal);
        gl.enableVertexAttribArray(normalLoc2);
        gl.vertexAttribPointer(normalLoc2, 3, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, obstacleBuffers[0].texCoord);
        gl.enableVertexAttribArray(texCoordLoc);
        gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
        
        // First pass: Draw filled polygons
        gl.uniform1i(materialLoc, 1); // Metal material for faces
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obstacleBuffers[0].indices);
        gl.drawElements(gl.TRIANGLES, obstacleBuffers[0].indexCount, gl.UNSIGNED_SHORT, 0);
        
        // Second pass: Draw wireframe edges
        if (obstacleBuffers[0].wireframeIndices) {
            gl.uniform1i(materialLoc, 2); // Wireframe material
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obstacleBuffers[0].wireframeIndices);
            gl.drawElements(gl.LINES, obstacleBuffers[0].wireframeIndexCount, gl.UNSIGNED_SHORT, 0);
        }
    });
}

function renderPlayer() {
    if (!playerBuffer) return;
    
    const modelLoc = gl.getUniformLocation(shaderProgram, 'u_modelMatrix');
    const normalLoc = gl.getUniformLocation(shaderProgram, 'u_normalMatrix');
    const materialLoc = gl.getUniformLocation(shaderProgram, 'u_materialType');
    
    const positionLoc = gl.getAttribLocation(shaderProgram, 'a_position');
    const normalLoc2 = gl.getAttribLocation(shaderProgram, 'a_normal');
    const texCoordLoc = gl.getAttribLocation(shaderProgram, 'a_texCoord');
    
    // Create model matrix for player (centered at camera position but slightly in front)
    const modelMatrix = createMatrix4();
    identity(modelMatrix);
    
    // Position player at camera position but slightly forward for visibility
    translate(modelMatrix, modelMatrix, [0, gameState.playerY, cameraPos[2] + 0.5]);
    
    // Scale down the fighter model
    scale(modelMatrix, modelMatrix, [0.15, 0.15, 0.15]);
    
    // Add slight banking effect based on movement
    const bankingAngle = gameState.playerVelocity * 2; // Banking based on vertical velocity
    rotateZ(modelMatrix, modelMatrix, bankingAngle);
    
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    gl.uniformMatrix4fv(normalLoc, false, modelMatrix);
    
    // Bind player geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, playerBuffer.position);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, playerBuffer.normal);
    gl.enableVertexAttribArray(normalLoc2);
    gl.vertexAttribPointer(normalLoc2, 3, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, playerBuffer.texCoord);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
    
    // Draw wireframe edges only in bright green
    if (playerBuffer.wireframeIndices) {
        gl.uniform1i(materialLoc, 2); // Bright green wireframe material
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, playerBuffer.wireframeIndices);
        gl.drawElements(gl.LINES, playerBuffer.wireframeIndexCount, gl.UNSIGNED_SHORT, 0);
    }
}

// Main game loop
let lastTime = 0;
function gameLoop(currentTime) {
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;
    
    updateGame(deltaTime);
    render();
    
    requestAnimationFrame(gameLoop);
}

// Initialize game
function init() {
    if (!initGL()) {
        return;
    }
    
    // Initialize audio
    initAudio();
    
    // Create shader program
    shaderProgram = createProgram(vertexShaderSource, fragmentShaderSource);
    if (!shaderProgram) {
        return;
    }
    
    // Create geometry
    tunnelBuffer = createTunnel();
    obstacleBuffers.push(createIcosahedron());
    playerBuffer = createFighter();
    
    // Setup input
    setupInput();
    
    // Canvas専用のコンテキストメニュー抑制
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });
    
    canvas.addEventListener('selectstart', (e) => {
        e.preventDefault();
        return false;
    });
    
    // canvasでの長押しメニュー完全抑制
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    // Setup fullscreen button event listener (once)
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    fullscreenBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        toggleFullscreen();
    });
    
    // Show title screen initially
    showTitleScreen();
    
    // Start game loop
    requestAnimationFrame(gameLoop);
}

// Start the game when page loads
window.addEventListener('load', init);

// Fullscreen functionality
function toggleFullscreen() {
    if (!document.fullscreenElement && !document.mozFullScreenElement && 
        !document.webkitFullscreenElement && !document.msFullscreenElement) {
        // Enter fullscreen
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.mozRequestFullScreen) {
            elem.mozRequestFullScreen();
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
        }
    } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

function updateFullscreenButton() {
    const btn = document.getElementById('fullscreenBtn');
    const isFullscreen = document.fullscreenElement || document.mozFullScreenElement || 
                        document.webkitFullscreenElement || document.msFullscreenElement;
    
    if (isFullscreen) {
        btn.textContent = '⛶ Exit Fullscreen';
    } else {
        btn.textContent = '⛶ Fullscreen';
    }
}

// Listen for fullscreen changes
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('mozfullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('msfullscreenchange', updateFullscreenButton);
