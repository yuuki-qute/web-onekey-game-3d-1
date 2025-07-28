// Game variables
let canvas, gl;
let shaderProgram, ssaoProgram;
let gameState = {
    life: 100,
    score: 0,
    speed: 0.02,
    playerY: 0,
    playerVelocity: 0,
    gameRunning: true,
    time: 0
};

// Input
let keys = {};

// Geometry buffers
let tunnelBuffer, obstacleBuffers = [];
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
    uniform int u_materialType; // 0: wall, 1: metal obstacle
    
    vec3 geometricPattern(vec2 uv) {
        float scale = 8.0;
        vec2 p = uv * scale;
        
        float pattern = 0.0;
        pattern += sin(p.x * 2.0) * sin(p.y * 2.0);
        pattern += sin(p.x * 4.0) * 0.5;
        
        float lines = abs(fract(p.x * 0.5) - 0.5) + abs(fract(p.y * 0.5) - 0.5);
        pattern = mix(pattern, lines, 0.3);
        
        return vec3(0.2 + pattern * 0.3, 0.3 + pattern * 0.2, 0.5 + pattern * 0.3);
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
        } else {
            // Metal obstacle material
            color = metalShading(normal, viewDir, lightDir);
        }
        
        // Basic lighting
        float NdotL = max(dot(normal, lightDir), 0.0);
        vec3 ambient = color * 0.3;
        vec3 diffuse = color * NdotL * 0.7;
        
        color = ambient + diffuse;
        
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
    
    // Enable depth testing
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    
    return true;
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
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
    
    // Calculate normals
    const normals = [];
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        const length = Math.sqrt(x * x + y * y + z * z);
        normals.push(x / length, y / length, z / length);
    }
    
    const texCoords = [];
    for (let i = 0; i < positions.length / 3; i++) {
        texCoords.push(0.5, 0.5);
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

// Input handling
function setupInput() {
    document.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'Space') {
            e.preventDefault();
        }
    });
    
    document.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });
}

// Game logic
function updateGame(deltaTime) {
    if (!gameState.gameRunning) return;
    
    gameState.time += deltaTime;
    
    // Player movement
    if (keys['Space']) {
        gameState.playerVelocity += 0.002;
    } else {
        gameState.playerVelocity -= 0.002;
    }
    
    gameState.playerVelocity = Math.max(-0.02, Math.min(0.02, gameState.playerVelocity));
    gameState.playerY += gameState.playerVelocity;
    
    // Wall collision
    if (gameState.playerY > 1.8 || gameState.playerY < -1.8) {
        gameState.life = Math.max(0, gameState.life - 5);
        gameState.playerY = Math.max(-1.8, Math.min(1.8, gameState.playerY));
        gameState.playerVelocity = 0;
    }
    
    // Update camera position
    cameraPos[1] = gameState.playerY;
    cameraPos[2] += gameState.speed;
    
    // Update score
    gameState.score = Math.floor(cameraPos[2] * 10);
    
    // Increase speed over time
    gameState.speed = 0.02 + gameState.time * 0.00001;
    
    // Spawn obstacles
    if (Math.random() < 0.01) {
        obstacles.push({
            x: (Math.random() - 0.5) * 3,
            y: (Math.random() - 0.5) * 3,
            z: cameraPos[2] + 20,
            rotation: 0
        });
    }
    
    // Update obstacles
    obstacles.forEach((obstacle, index) => {
        obstacle.rotation += deltaTime * 0.002;
        
        // Check collision with player
        const dx = obstacle.x - 0;
        const dy = obstacle.y - gameState.playerY;
        const dz = obstacle.z - cameraPos[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (distance < 0.5) {
            gameState.life = Math.max(0, gameState.life - 10);
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
}

function showGameOver() {
    const highScore = parseInt(localStorage.getItem('highScore') || '0');
    if (gameState.score > highScore) {
        localStorage.setItem('highScore', gameState.score.toString());
    }
    
    document.getElementById('finalScore').textContent = gameState.score;
    document.getElementById('finalHighScore').textContent = Math.max(highScore, gameState.score);
    document.getElementById('gameOver').style.display = 'block';
}

function restartGame() {
    gameState = {
        life: 100,
        score: 0,
        speed: 0.02,
        playerY: 0,
        playerVelocity: 0,
        gameRunning: true,
        time: 0
    };
    
    cameraPos = [0, 0, 0];
    obstacles = [];
    
    document.getElementById('gameOver').style.display = 'none';
    updateUI();
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
    gl.uniform3f(lightDirLoc, 1.0, -1.0, -1.0);
    gl.uniform3f(cameraPosLoc, cameraPos[0], cameraPos[1], cameraPos[2]);
    gl.uniform1f(timeLoc, gameState.time);
    
    // Render tunnel
    renderTunnel();
    
    // Render obstacles
    renderObstacles();
}

function renderTunnel() {
    const modelLoc = gl.getUniformLocation(shaderProgram, 'u_modelMatrix');
    const normalLoc = gl.getUniformLocation(shaderProgram, 'u_normalMatrix');
    const materialLoc = gl.getUniformLocation(shaderProgram, 'u_materialType');
    
    const modelMatrix = createMatrix4();
    identity(modelMatrix);
    translate(modelMatrix, modelMatrix, [0, 0, -25]);
    
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    gl.uniformMatrix4fv(normalLoc, false, modelMatrix);
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
    gl.drawElements(gl.TRIANGLES, tunnelBuffer.indexCount, gl.UNSIGNED_SHORT, 0);
}

function renderObstacles() {
    if (obstacleBuffers.length === 0) return;
    
    const modelLoc = gl.getUniformLocation(shaderProgram, 'u_modelMatrix');
    const normalLoc = gl.getUniformLocation(shaderProgram, 'u_normalMatrix');
    const materialLoc = gl.getUniformLocation(shaderProgram, 'u_materialType');
    
    gl.uniform1i(materialLoc, 1); // Metal material
    
    const positionLoc = gl.getAttribLocation(shaderProgram, 'a_position');
    const normalLoc2 = gl.getAttribLocation(shaderProgram, 'a_normal');
    const texCoordLoc = gl.getAttribLocation(shaderProgram, 'a_texCoord');
    
    obstacles.forEach(obstacle => {
        const modelMatrix = createMatrix4();
        identity(modelMatrix);
        translate(modelMatrix, modelMatrix, [obstacle.x, obstacle.y, obstacle.z]);
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
        
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obstacleBuffers[0].indices);
        gl.drawElements(gl.TRIANGLES, obstacleBuffers[0].indexCount, gl.UNSIGNED_SHORT, 0);
    });
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
    
    // Create shader program
    shaderProgram = createProgram(vertexShaderSource, fragmentShaderSource);
    if (!shaderProgram) {
        return;
    }
    
    // Create geometry
    tunnelBuffer = createTunnel();
    obstacleBuffers.push(createIcosahedron());
    
    // Setup input
    setupInput();
    
    // Load high score
    updateUI();
    
    // Start game loop
    requestAnimationFrame(gameLoop);
}

// Start the game when page loads
window.addEventListener('load', init);
