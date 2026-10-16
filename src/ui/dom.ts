/** Tiny DOM helpers (no framework). */
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function slider(label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, onInput: (v: number) => void) {
  const out = h('output', {}, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  return h('label', { class: 'row slider' }, h('span', { class: 'row-label' }, label), input, out);
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void, disabled = false, hint = '') {
  const input = h('input', { type: 'checkbox', checked: value, disabled }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'row toggle' + (disabled ? ' disabled' : '') }, h('span', { class: 'row-label' }, label, hint ? h('small', {}, hint) : null), input, h('span', { class: 'switch' }));
}

export function segmented<T extends string>(label: string, options: { id: T; name: string; disabled?: boolean; title?: string }[], value: T, onChange: (v: T) => void) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  for (const o of options) {
    const b = h('button', { class: 'seg-btn' + (o.id === value ? ' on' : ''), disabled: o.disabled, title: o.title ?? '', role: 'radio', 'aria-checked': o.id === value ? 'true' : 'false' }, o.name);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.seg-btn').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('on');
      b.setAttribute('aria-checked', 'true');
      onChange(o.id);
    });
    wrap.append(b);
  }
  return h('div', { class: 'row seg-row' }, h('span', { class: 'row-label' }, label), wrap);
}

export function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function pickFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((res) => {
    const input = h('input', { type: 'file', accept }) as HTMLInputElement;
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      res(f ? await f.text() : null);
    });
    input.click();
  });
}
