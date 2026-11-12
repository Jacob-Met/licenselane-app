/* Inspect the selected artwork without losing the buyer's project. */
(() => {
  'use strict';
  const preview = document.getElementById('asset-preview');
  if (!preview) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'artwork-inspector';
  dialog.setAttribute('aria-labelledby', 'artwork-inspector-title');
  dialog.innerHTML = '<header><h2 id="artwork-inspector-title"></h2><button type="button" class="inspector-close">Close preview</button></header><div class="inspector-toolbar" aria-label="Artwork zoom"><button type="button" class="inspector-out" aria-label="Zoom out">−</button><output class="inspector-scale" aria-live="polite"></output><button type="button" class="inspector-in" aria-label="Zoom in">+</button><button type="button" class="inspector-fit">Fit</button><button type="button" class="inspector-zoom" aria-pressed="false">Actual size</button></div><p class="inspector-help" id="inspector-help">Swipe or scroll to explore. Use + / − to zoom and Home to fit.</p><div class="inspector-message" role="status"></div><button type="button" class="inspector-retry" hidden>Retry preview</button><div class="inspector-canvas" tabindex="0" aria-label="Artwork preview" aria-describedby="inspector-help"><img alt="" draggable="false"></div>';
  document.body.append(dialog);
  const views=document.createElement('nav');views.className='inspector-views';views.setAttribute('aria-label','Artwork views');views.hidden=true;dialog.append(views);
  let sources=[],selectedView=0;
  function selectView(index){
    selectedView=index;sourceURL=sources[index];fitted=true;
    [...views.children].forEach((button,i)=>button.setAttribute('aria-current',i===index?'true':'false'));
    views.children[index]?.scrollIntoView({block:'nearest',inline:'nearest'});load();
  }
  const canvas = dialog.querySelector('.inspector-canvas');
  const image = dialog.querySelector('img');
  const zoom = dialog.querySelector('.inspector-zoom');
  const fit = dialog.querySelector('.inspector-fit');
  const plus = dialog.querySelector('.inspector-in');
  const minus = dialog.querySelector('.inspector-out');
  const output = dialog.querySelector('output');
  const message = dialog.querySelector('.inspector-message');
  const retry = dialog.querySelector('.inspector-retry');
  let metadataController;
  let opener, sourceURL, loadVersion = 0, width = 0, height = 0, scale = 1, fitted = true;
  const fitScale = () => Math.min(canvas.clientWidth / width, canvas.clientHeight / height, 1);
  const render = (next, keepCenter = true) => {
    if (!width || !height) return;
    const x = (canvas.scrollLeft + canvas.clientWidth / 2) / (width * scale);
    const y = (canvas.scrollTop + canvas.clientHeight / 2) / (height * scale);
    scale = Math.max(fitScale(), Math.min(4, next));
    image.style.width = Math.round(width * scale) + 'px';
    image.style.height = Math.round(height * scale) + 'px';
    output.value = Math.round(scale * 100) + '%';
    zoom.setAttribute('aria-pressed', String(Math.abs(scale - 1) < .001));
    minus.disabled = scale <= fitScale() + .001; plus.disabled = scale >= 4;
    canvas.classList.toggle('is-zoomed', scale > fitScale() + .001);
    canvas.scrollTo(keepCenter ? x * width * scale - canvas.clientWidth / 2 : 0, keepCenter ? y * height * scale - canvas.clientHeight / 2 : 0);
  };
  const changeZoom = factor => { fitted = false; render(scale * factor); };
  const fitImage = () => { fitted = true; render(fitScale(), false); };
  plus.addEventListener('click', () => changeZoom(Math.SQRT2));
  minus.addEventListener('click', () => changeZoom(1 / Math.SQRT2));
  fit.addEventListener('click', fitImage);
  zoom.addEventListener('click', () => { fitted = false; render(1); });
  canvas.addEventListener('keydown', event => {
    if (event.key === '+' || event.key === '=') changeZoom(Math.SQRT2);
    else if (event.key === '-') changeZoom(1 / Math.SQRT2);
    else if (event.key === 'Home') fitImage();
    else return;
    event.preventDefault();
  });
  new ResizeObserver(() => { if (dialog.open && width) render(fitted ? fitScale() : scale, !fitted); }).observe(canvas);
  let drag;
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !canvas.classList.contains('is-zoomed')) return;
    drag = {x:event.clientX,y:event.clientY,left:canvas.scrollLeft,top:canvas.scrollTop};
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', event => { if (drag) canvas.scrollTo(drag.left + drag.x - event.clientX, drag.top + drag.y - event.clientY); });
  const endDrag = () => { drag = null; canvas.classList.remove('is-dragging'); };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('lostpointercapture', endDrag);
  dialog.querySelector('.inspector-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { loadVersion++; metadataController?.abort(); endDrag(); if (opener?.isConnected) opener.focus(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  async function load() {
    metadataController?.abort();
    const version = ++loadVersion;
    width = height = 0; image.hidden = true; retry.hidden = true;
    [zoom, fit, plus, minus].forEach(button => { button.disabled = true; });
    output.value = ''; message.textContent = 'Loading artwork…'; canvas.setAttribute('aria-busy', 'true');
    try {
      image.src = sourceURL;
      await image.decode();
      if (version !== loadVersion || !dialog.open) return;
      width = image.naturalWidth; height = image.naturalHeight; image.hidden = false;
      message.textContent = ''; [zoom, fit, plus, minus].forEach(button => { button.disabled = false; }); fitImage();
      // Inspection uses the decoded image immediately. Only SVG previews need
      // optional coordinate metadata; it must never hold the artwork or tools.
      if (/\.svg(?:[?#]|$)/i.test(sourceURL)) refineSvgSize(version);
    } catch {
      if (version !== loadVersion || !dialog.open) return;
      message.textContent = 'Artwork could not be loaded. Retry or close to return to your work.'; retry.hidden = false;
    } finally { if (version === loadVersion) canvas.setAttribute('aria-busy', 'false'); }
  }
  async function refineSvgSize(version) {
    const controller = new AbortController(); metadataController = controller;
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(sourceURL, {signal:controller.signal});
      if (!response.ok || !response.headers.get('content-type')?.includes('image/svg+xml')) return;
      const svg = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
      const box = svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
      if (version !== loadVersion || !dialog.open || !fitted) return;
      if (box?.length === 4 && box[2] > 0 && box[3] > 0 && box[2] <= 20000 && box[3] <= 20000) {
        [width,height] = box.slice(2); fitImage();
      }
    } catch { /* Decoded artwork remains usable without optional metadata. */ }
    finally { clearTimeout(timer); if (metadataController === controller) metadataController = null; }
  }
  retry.addEventListener('click', load);
  function openPreview(button, source, title) {
    opener = button;
    try{sources=JSON.parse(source.dataset.previewUrls||'[]');}catch{sources=[];}
    if(!Array.isArray(sources)||!sources.length)sources=[source.currentSrc||source.src];
    selectedView=0;sourceURL=sources[0];views.replaceChildren();views.hidden=sources.length<2;
    sources.forEach((url,index)=>{
      const choice=document.createElement('button');choice.type='button';choice.setAttribute('aria-label','View '+(index+1)+' of '+sources.length);choice.setAttribute('aria-current',index===0?'true':'false');
      const thumbnail=document.createElement('img');thumbnail.src=url;thumbnail.alt='';const number=document.createElement('span');number.textContent=String(index+1);choice.append(thumbnail,number);
      choice.addEventListener('click',()=>selectView(index));choice.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=(index+(event.key==='ArrowRight'?1:-1)+sources.length)%sources.length;selectView(next);views.children[next].focus();});
      views.append(choice);
    });
    dialog.querySelector('h2').textContent = title;
    image.alt = source.alt; dialog.showModal(); load();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('.saved-preview-open,.review-preview-open');
    const source = button?.querySelector('img');
    if (source) openPreview(button, source, button.closest('.saved-edition')?.querySelector('.saved-edition-name')?.textContent || button.dataset.previewTitle || 'Saved artwork');
  });
  const attach = () => {
    const media = preview.querySelector('.asset-media');
    const source = media?.querySelector('img');
    if (!source || media.querySelector('.inspect-artwork')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'inspect-artwork'; button.textContent = (()=>{try{const count=JSON.parse(source.dataset.previewUrls||'[]').length;return count>1?'Inspect '+count+' artwork views':'Inspect artwork details';}catch{return 'Inspect artwork details';}})();
    button.addEventListener('click', () => {
      openPreview(button, source, preview.querySelector('h3')?.textContent || 'Artwork preview');
    });
    media.append(button);
  };
  new MutationObserver(attach).observe(preview, {childList:true, subtree:true}); attach();
})();
