# PFD TikZ Studio

A static, client-side editor for drawing chemical engineering process flow diagrams and exporting clean TikZ.

Open `index.html` directly in a browser, or serve this folder with any static server. The app has no backend and no build step, so it is GitHub Pages compatible as-is.

## Files

- `index.html` - application shell
- `styles.css` - responsive editor layout and SVG UI styling
- `app.js` - scene graph, SVG rendering, interactions, JSON import/export, and TikZ generation
- `tikz.py` - original Tkinter reference app

## TikZ Notes

The exporter uses semantic TikZ commands such as `rectangle`, `circle`, `ellipse`, `--`, `arc`, `node`, and Bezier controls for exchanger internals. Pattern fills require `\usetikzlibrary{patterns}` in the LaTeX preamble.
