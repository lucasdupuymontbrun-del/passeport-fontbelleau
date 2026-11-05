// Accès aux données dynamiques (Supabase). Sans configuration, le passeport fonctionne en lecture seule
// avec le scénario du fichier data/<REF>.json.
const CFG = window.PASSEPORT_CONFIG || {};

export function configured() {
  return Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase?.createClient);
}

let client = null;
export function db() {
  if (!configured()) return null;
  if (!client) {
    client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return client;
}

function withTimeout(promise, ms = 9000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Délai dépassé : le service de suivi ne répond pas.')), ms))
  ]);
}

export async function currentUser() {
  const c = db();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data?.session?.user || null;
}

export function onAuthChange(cb) {
  const c = db();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_evt, session) => cb(session?.user || null));
  return () => data.subscription.unsubscribe();
}

export async function role(user) {
  const c = db();
  if (!c || !user?.email) return null;
  const { data, error } = await c.from('membres').select('role').eq('email', user.email.toLowerCase()).maybeSingle();
  if (error) return null;
  return data?.role || null; // 'editeur' | 'lecteur' | null
}

export async function signIn(email) {
  const c = db();
  const back = location.origin + location.pathname; // retour sur la page du passeport après le clic dans l'e-mail
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: back, shouldCreateUser: true } });
  if (error) throw error;
}

export async function signOut() {
  await db()?.auth.signOut();
}

export async function loadState(ref) {
  const c = db();
  const q = (p) => withTimeout(p).then(({ data, error }) => { if (error) throw error; return data; });
  const [ouvrage, evenements, notes, photos, champs, documents] = await Promise.all([
    q(c.from('ouvrages').select('*').eq('ref', ref).maybeSingle()),
    q(c.from('evenements').select('*').eq('ref', ref).order('cree_le', { ascending: false }).limit(200)),
    q(c.from('notes').select('*').eq('ref', ref).order('cree_le', { ascending: false })),
    q(c.from('photos').select('*').eq('ref', ref).order('cree_le', { ascending: false })),
    q(c.from('champs').select('*').eq('ref', ref)),
    q(c.from('documents').select('*').eq('ref', ref).order('cree_le', { ascending: true }))
  ]);
  return { ouvrage, evenements, notes, photos, champs, documents };
}

export async function changeStatus(ref, statut, commentaire) {
  const { error } = await db().rpc('changer_statut', { p_ref: ref, p_statut: statut, p_commentaire: commentaire || null });
  if (error) throw error;
}

export async function addNote(ref, type, texte) {
  const { error } = await db().from('notes').insert({ ref, type, texte });
  if (error) throw error;
}

export async function setNoteLevee(id, levee) {
  const { error } = await db().from('notes').update({ levee }).eq('id', id);
  if (error) throw error;
}

export async function setField(ref, cle, valeur, source) {
  const { error } = await db().from('champs').upsert({ ref, cle, valeur, source }, { onConflict: 'ref,cle' });
  if (error) throw error;
}

function safeName(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
}

async function shrinkImage(file, maxSide = 2000) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (k >= 1 && file.size < 2.5e6) return file;
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) { return file; }
}

export async function uploadPhoto(ref, file, legende) {
  const c = db();
  const f = await shrinkImage(file);
  const path = `${ref}/${Date.now()}_${safeName(f.name)}`;
  const up = await c.storage.from('photos').upload(path, f, { contentType: f.type, upsert: false });
  if (up.error) throw up.error;
  const { error } = await c.from('photos').insert({ ref, chemin: path, legende: legende || null });
  if (error) throw error;
}

export function photoUrl(path) {
  return db().storage.from('photos').getPublicUrl(path).data.publicUrl;
}

export async function uploadDocument(ref, file, meta) {
  const c = db();
  const path = `${ref}/${Date.now()}_${safeName(file.name)}`;
  const up = await c.storage.from('documents').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (up.error) throw up.error;
  const { error } = await c.from('documents').insert({ ref, chemin: path, ...meta });
  if (error) throw error;
}

export async function signedUrl(path, download = false) {
  const { data, error } = await db().storage.from('documents').createSignedUrl(path, 3600, download ? { download: true } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export function subscribe(ref, onChange) {
  const c = db();
  if (!c) return () => {};
  const ch = c.channel('passeport-' + ref);
  for (const table of ['ouvrages', 'evenements', 'notes', 'photos', 'champs', 'documents']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `ref=eq.${ref}` }, () => onChange(table));
  }
  ch.subscribe();
  return () => c.removeChannel(ch);
}
