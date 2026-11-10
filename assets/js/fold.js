// Téléphone : les rubriques longues (attribut data-fold) sont repliées.
// Leur bouton, le menu des rubriques ou un lien #rubrique les déplie. Sur ordinateur, rien ne change.
const secs = [...document.querySelectorAll('.sec[data-fold]')];

function setOpen(sec, open) {
  sec.classList.toggle('is-open', open);
  const b = sec.querySelector(':scope > .sec-head .fold-btn');
  if (!b) return;
  b.setAttribute('aria-expanded', String(open));
  b.querySelector('span').textContent = open ? 'Replier' : (sec.dataset.fold || 'Afficher le détail');
}

for (const sec of secs) {
  const head = sec.querySelector(':scope > .sec-head');
  const body = sec.querySelector(':scope > .sec-body');
  if (!head || !body) continue;
  if (!body.id) body.id = `${sec.id}-corps`;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fold-btn';
  b.setAttribute('aria-controls', body.id);
  b.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  b.addEventListener('click', () => {
    const open = !sec.classList.contains('is-open');
    setOpen(sec, open);
    if (!open && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ block: 'start' });
  });
  head.append(b);
  setOpen(sec, false);
}

function openFromHash(h) {
  if (!h || h.length < 2) return;
  const t = document.getElementById(decodeURIComponent(h.slice(1)));
  const sec = t?.closest?.('.sec[data-fold]');
  if (sec) setOpen(sec, true);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#"]');
  if (a) openFromHash(a.getAttribute('href'));
}, true);
addEventListener('hashchange', () => openFromHash(location.hash));
openFromHash(location.hash);
