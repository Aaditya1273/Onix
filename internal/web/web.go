// Package web holds the small self-contained pages VIGIL serves itself at
// /web/: the reveal of a local history, the public playground, and time
// travel. They need no Node build, so `vigil-cli reveal` works from a bare
// Go binary.
package web

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed static
var static embed.FS

// Handler serves the pages under /web/.
func Handler() http.Handler {
	sub, _ := fs.Sub(static, "static")
	return http.StripPrefix("/web/", http.FileServer(http.FS(sub)))
}
