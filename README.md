# Astro Pano Studio

Application locale pour assembler des panoramas de jour et creer une image de nuit a partir d'un time-lapse: ciel empile, premier plan garde une seule fois.

## Lancer le logiciel

```powershell
npm start
```

Puis ouvrir:

```text
http://localhost:4173
```

Si `node` est refuse par Windows dans cette session, lance plutot:

```powershell
.\lancer.ps1
```

## Utilisation

1. Importe les photos.
2. Choisis `Jour` pour assembler une rangee panoramique avec recouvrement.
3. Choisis `Nuit` pour empiler les images du ciel.
4. En mode nuit, ajuste `Derive X/Y par image` pour suivre le mouvement des etoiles.
5. Ajuste `Limite premier plan` pour garder les montagnes, arbres ou batiments d'une seule image.
6. Clique `Assembler`, puis `Exporter PNG`.

## Multi-thread et GPU

- Le panorama de jour utilise WebGL2 quand il est disponible. C'est le chemin GPU.
- Le mode nuit decoupe l'image en bandes et lance plusieurs Web Workers en parallele. Le calcul se fait hors du fil principal pour garder l'interface reactive.
- Si WebGL2 ou Worker ne sont pas disponibles, l'application bascule sur le moteur CPU Canvas.

## Reglages photo et presets

- `Projection` permet de choisir une mise en forme rectiligne, cylindrique ou spherique.
- `Anti-vignettage` corrige les coins sombres avec un gain radial.
- `Reglages auto nuit` ajuste automatiquement le contraste apres empilement.
- `Flou gaussien sublime` ajoute un halo doux pour donner plus de presence aux etoiles et a la Voie lactee.
- Les presets nocturnes donnent des bases rapides: Voie lactee detaillee, bleu nuit froid, ciel naturel doux, premier plan lune et silhouette presente.
- Le logiciel n'ajoute pas de silhouette humaine. Si une personne est dans la prise de vue RAW/TIFF du premier plan, elle est conservee naturellement et peut etre protegee pendant le rendu.
- Le premier plan peut rester normal ou etre reeclaire doucement.

## RAW

Les navigateurs ne savent pas decoder directement la plupart des RAW (`.ARW`, `.CR3`, `.NEF`, `.RAF`, `.DNG`, etc.). Le flux conseille est:

1. Developper tous les RAW avec les memes reglages.
2. Exporter en TIFF 16 bits ou en JPEG pleine taille.
3. Importer ces fichiers exportes dans Astro Pano Studio.

Pour la Voie lactee, garde une balance des blancs identique sur toutes les images et desactive les reglages automatiques qui changent d'une photo a l'autre.

## Notes importantes

- Le mode jour assemble une rangee horizontale avec fondu dans les zones de recouvrement.
- Le mode nuit empile le ciel avec une methode `Etoiles intenses` ou `Moyenne douce`.
- Le premier plan unique est pris sur la premiere image lisible importee.
- Pour un panorama multi-rangee ou une correction optique tres avancee, il faudra ensuite brancher un moteur specialise comme Hugin. Cette premiere version fournit un outil local simple, utilisable et modifiable.
