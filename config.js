// Configuration du passeport numérique.
// siteUrl : adresse publique du site (GitHub Pages), utilisée pour le QR code et les liens partagés.
// supabaseUrl / supabaseAnonKey : projet Supabase du suivi de chantier. La clé « anon » (ou « publishable »)
// est publique par conception : la sécurité repose sur les règles d'accès (RLS) définies dans supabase/schema.sql.
// Ne jamais mettre ici la clé « service_role » / « secret ».
window.PASSEPORT_CONFIG = {
  siteUrl: 'https://lucasdupuymontbrun-del.github.io/passeport-fontbelleau/',
  supabaseUrl: 'https://wbeiqwmaqjhyhyhwbguq.supabase.co',
  supabaseAnonKey: 'sb_publishable_uxEfS6tA_j1o8S50UtrINQ_DU_sYWSh'
};
