/* =====================================================================
   LOGIN SCREEN with VELARIS WebGL Living Gradient Shader
   Credentials: id = Envision | pass = 1234
   ===================================================================== */

(function () {
  const VALID_ID   = 'Envision';
  const VALID_PASS = '1234';

  const screen    = document.getElementById('login-screen');
  const form      = document.getElementById('login-form');
  const idInput   = document.getElementById('login-id');
  const pwInput   = document.getElementById('login-pass');
  const errEl     = document.getElementById('login-error');
  const btn       = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('btn-logout');
  const canvas    = document.getElementById('login-velaris-canvas');

  if (!screen) return;

  // Initialize WebGL Velaris Shader on canvas
  initVelarisShader(canvas, {
    bg: '#040914',
    colors: ['#10b981', '#2563eb', '#f59e0b', '#061325'],
    speed: 1.8,
    grain: 0.25
  });

  // Check if session is already authorized
  if (sessionStorage.getItem('tn_pds_auth') === 'true') {
    screen.style.display = 'none';
  } else {
    screen.style.display = 'flex';
    screen.classList.remove('hiding');
    setTimeout(() => { if (idInput) idInput.focus(); }, 150);
  }

  // Clear error on typing
  [idInput, pwInput].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => errEl.classList.remove('visible'));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); tryLogin(); }
    });
  });

  if (form) {
    form.addEventListener('submit', e => { e.preventDefault(); tryLogin(); });
  }

  function tryLogin() {
    const id   = idInput ? idInput.value.trim() : '';
    const pass = pwInput ? pwInput.value : '';

    if (id === VALID_ID && pass === VALID_PASS) {
      /* SUCCESS */
      sessionStorage.setItem('tn_pds_auth', 'true');
      btn.innerHTML = '<span>✅</span> <span>OFFICIAL ACCESS GRANTED</span>';
      btn.style.background = 'linear-gradient(135deg, #10b981, #047857)';
      btn.style.boxShadow  = '0 0 35px rgba(16, 185, 129, 0.45)';
      errEl.classList.remove('visible');

      setTimeout(() => {
        screen.classList.add('hiding');
        setTimeout(() => {
          screen.style.display = 'none';
          if (window.launchMetroHero) {
            window.launchMetroHero();
          }
        }, 450);
      }, 550);

    } else {
      /* FAILURE */
      errEl.classList.add('visible');
      if (pwInput) pwInput.value = '';

      btn.classList.remove('shaking');
      void btn.offsetWidth;
      btn.classList.add('shaking');
      btn.addEventListener('animationend', () => btn.classList.remove('shaking'), { once: true });

      const wrongField = id !== VALID_ID ? idInput : pwInput;
      if (wrongField) {
        wrongField.style.borderColor = '#ef4444';
        wrongField.style.boxShadow   = '0 0 0 3px rgba(239, 68, 68, 0.25)';
        setTimeout(() => {
          wrongField.style.borderColor = '';
          wrongField.style.boxShadow   = '';
        }, 1200);
        wrongField.focus();
      }
    }
  }

  // Lock / Logout terminal functionality
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('tn_pds_auth');
      btn.innerHTML = '<span>🔐</span> <span>AUTHORIZE &amp; OPEN TERMINAL</span>';
      btn.style.background = '';
      btn.style.boxShadow = '';
      if (pwInput) pwInput.value = '';
      errEl.classList.remove('visible');

      screen.style.display = 'flex';
      void screen.offsetWidth;
      screen.classList.remove('hiding');
      if (idInput) idInput.focus();
    });
  }

  // =========================================================
  // VELARIS WEBGL SIMPLEX NOISE SHADER ENGINE
  // =========================================================
  function initVelarisShader(canvasEl, options) {
    if (!canvasEl) return;
    const gl = canvasEl.getContext('webgl');
    if (!gl) return;

    const { bg, colors, speed, grain } = options;

    const vertexShaderGLSL = `
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fragmentShaderGLSL = `
      precision highp float;
      varying vec2 vUv;

      uniform vec2  u_resolution;
      uniform float u_time;
      uniform float u_grain;
      uniform vec3  u_colors[4];
      uniform vec3  u_bg;

      vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

      float snoise(vec2 v){
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                 -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
          dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 uv = vUv;
        float ratio = u_resolution.x / u_resolution.y;
        vec2 p = uv - 0.5;
        p.x *= ratio;

        float t = u_time * 0.1;

        float n1 = snoise(p * 0.4 + vec2(t * 0.2, -t * 0.3));
        float n2 = snoise(p * 0.55 + vec2(-t * 0.15, t * 0.25) + n1 * 0.25);
        float n3 = snoise(p * 0.75 + vec2(t * 0.1, -t * 0.2) + n2 * 0.2);

        vec3 col = u_bg;
        
        float dist = length(p) * 1.5;
        float vignette = 1.0 - smoothstep(0.3, 1.2, dist);
        
        col = mix(col, u_colors[0], smoothstep(-0.2, 0.5, n1) * 0.85);
        col = mix(col, u_colors[1], smoothstep(-0.1, 0.6, n2) * 0.7);
        col = mix(col, u_colors[2], smoothstep(-0.3, 0.4, n3) * 0.6);
        col = mix(col, u_colors[3], smoothstep(0.0, 0.7, n1 * n2) * 0.5);

        float glow = smoothstep(0.8, 0.0, dist) * 0.3;
        col += u_colors[1] * glow;

        col = mix(col * 0.2, col, vignette);

        float grain = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 + u_time);
        col += (grain - 0.5) * u_grain * 0.1;

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const hexToRgb = (hex) => {
      const h = hex.replace('#', '');
      return [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
      ];
    };

    const createShader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl.VERTEX_SHADER, vertexShaderGLSL));
    gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fragmentShaderGLSL));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const pos = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const locs = {
      res: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      grain: gl.getUniformLocation(program, 'u_grain'),
      colors: gl.getUniformLocation(program, 'u_colors'),
      bg: gl.getUniformLocation(program, 'u_bg'),
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvasEl.width = canvasEl.clientWidth * dpr;
      canvasEl.height = canvasEl.clientHeight * dpr;
      gl.viewport(0, 0, canvasEl.width, canvasEl.height);
    };

    window.addEventListener('resize', resize);
    resize();

    let raf;
    const render = (t) => {
      gl.uniform2f(locs.res, canvasEl.width, canvasEl.height);
      gl.uniform1f(locs.time, t * 0.001 * speed);
      gl.uniform1f(locs.grain, grain);
      gl.uniform3f(locs.bg, ...hexToRgb(bg));

      const flat = new Float32Array(colors.slice(0, 4).flatMap(hexToRgb));
      gl.uniform3fv(locs.colors, flat);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
  }
})();
