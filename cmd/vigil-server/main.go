package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Aaditya1273/Vigil/internal/appserver"
	"github.com/Aaditya1273/Vigil/internal/vigil"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// initTracer exports spans to any OTLP endpoint. The exporter reads the
// standard OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS itself.
func initTracer(ctx context.Context) (func(context.Context) error, error) {
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName("vigil-control-plane"),
			semconv.ServiceVersion("1.0.0"),
			attribute.String("vigil.component", "backend"),
		)),
	)
	otel.SetTracerProvider(tp)
	return tp.Shutdown, nil
}

// loadEnvFile sets KEY=value lines from path, if it exists.
func loadEnvFile(path string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			os.Setenv(strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`))
		}
	}
}

func main() {
	loadEnvFile(".env.local")

	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" {
		if shutdown, err := initTracer(context.Background()); err != nil {
			slog.Warn("vigil: OTel tracer disabled", slog.String("error", err.Error()))
		} else {
			defer shutdown(context.Background())
		}
	}

	addr := vigil.EnvOr("ADDR", ":8080")
	var srv *http.Server
	if vigil.Env("PLAYGROUND") == "1" { // hosted playground: nothing but the playground
		var err error
		if srv, err = appserver.NewPlaygroundServer(addr, slog.Default()); err != nil {
			slog.Error("playground", "error", err)
			os.Exit(1)
		}
	} else {
		srv = appserver.NewServer(addr)
	}

	go func() {
		slog.Info("vigil server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
