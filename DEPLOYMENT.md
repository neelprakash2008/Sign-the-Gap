DEPLOYMENT OPTIONS

Choose one of these methods to get a public URL:

=== OPTION 1: Netlify Drop (Easiest - no Git/login needed) ===

1. Go to https://app.netlify.com/drop
2. Drag and drop the contents of the `web/` folder onto the page:
   - index.html
   - app.js
   - styles.css
3. Netlify will generate a public URL instantly (e.g., https://xxxxx.netlify.app)
4. Share that URL with anyone to access your app globally

=== OPTION 2: GitHub Pages ===

1. Create a GitHub account (if you don't have one): https://github.com/signup
2. Create a new repository (name it anything, e.g., "sign-language-web")
3. Upload the `web/` folder contents to the repository root
4. Go to Settings > Pages > Build and deployment
5. Set Source to "Deploy from a branch" 
6. Select the branch and root folder
7. GitHub will generate a URL like https://yourusername.github.io/sign-language-web

=== OPTION 3: Vercel ===

1. Go to https://vercel.com/import
2. Import from GitHub (if you have a GitHub repo with the web/ folder)
   OR drag & drop the `web/` folder
3. Vercel generates a public URL instantly

RECOMMENDED: Use Netlify Drop (Option 1) — it's fastest and requires no setup.

After deploying, test:
- Click "Camera: ON"
- Show gestures (Hello, I Love You, Help)
- Test speech-to-text (if Chrome/Edge)
- Try keyboard shortcuts: Space=speech, Tab=camera, F11=fullscreen
