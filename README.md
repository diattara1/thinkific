# Thinkific + PayTech + Render

Projet Node.js prêt à déployer sur Render pour :
- afficher une page de paiement externe,
- créer une transaction PayTech,
- recevoir l'IPN PayTech,
- créer/trouver l'utilisateur Thinkific,
- l'inscrire automatiquement au cours.

## Structure

- `server.js` : application Express
- `db.js` : connexion PostgreSQL
- `schema.sql` : tables SQL
- `.env.example` : variables d'environnement
- `render.yaml` : blueprint Render

## Étapes d'installation

### 1) Créer la base PostgreSQL sur Render
- Crée une base PostgreSQL Render.
- Copie la `connectionString` dans `DATABASE_URL`.

### 2) Importer le schéma SQL
Exécute `schema.sql` dans ta base.

### 3) Renseigner les variables d'environnement
Copie `.env.example` vers `.env` en local, ou remplis-les dans Render.

### 4) Déployer sur Render
- Push le projet sur GitHub
- Dans Render : **New > Web Service**
- Build command : `npm install`
- Start command : `node server.js`
- Associe les variables d'environnement

### 5) Paramétrer Thinkific
Dans la page du cours, mets un bouton vers :

```text
https://votre-app.onrender.com/pay?product=formation-ia
```

### 6) Paramétrer PayTech
Le service envoie automatiquement :
- `ipn_url = https://votre-app.onrender.com/paytech/ipn`
- `success_url = SUCCESS_REDIRECT_URL`
- `cancel_url = CANCEL_REDIRECT_URL`

## Important

### Thinkific API
Ce projet utilise :
- `POST /users`
- `POST /enrollments`

Si ton compte Thinkific ou l'API explorer affiche un nom de champ légèrement différent, adapte uniquement les fonctions :
- `createThinkificUser()`
- `createThinkificEnrollment()`

Le reste du projet ne change pas.

### Multi-cours
Ajoute simplement des lignes dans `products`.

### Codes promo
Ajoute des lignes dans `coupons`, et si besoin restreins-les à certains produits via `coupon_products`.

## Tests

### Test page de paiement
```text
https://votre-app.onrender.com/pay?product=formation-ia
```

### Test santé
```text
https://votre-app.onrender.com/health
```

## Flux complet
1. Thinkific appelle `/pay?product=slug`
2. L'étudiant remplit le formulaire
3. Le serveur crée la transaction PayTech
4. PayTech encaisse
5. PayTech appelle `/paytech/ipn`
6. Le serveur inscrit l'étudiant dans Thinkific
