package firewall

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/Aaditya1273/Vigil/internal/graph"
)

// With VIGIL_VALUE_KEY set, a digest in the graph can't be confirmed by hashing
// a guess: the plain SHA-256 of the value no longer matches it.
func TestValueDigestIsKeyed(t *testing.T) {
	old := valueKey
	t.Cleanup(func() { valueKey = old })
	secret := "sk_live_51HxAbCdEfGh123456"

	valueKey = nil
	if valueHash(secret) != graph.Hash("value", secret) {
		t.Fatal("without a key the digest must stay the plain one existing graphs hold")
	}

	valueKey = []byte("key-one")
	keyed := valueHash(secret)
	guess := sha256.Sum256([]byte("value:" + secret))
	if keyed == hex.EncodeToString(guess[:]) || keyed == graph.Hash("value", secret) {
		t.Fatal("a keyed digest must not equal an unkeyed hash of the guess")
	}
	if valueHash(secret) != keyed {
		t.Fatal("the same key must give the same digest, or reads and egress would never match")
	}
	valueKey = []byte("key-two")
	if valueHash(secret) == keyed {
		t.Fatal("a different key must give a different digest")
	}
}

// The same secret quoted, padded, recased or followed by punctuation is one value.
func TestValueDigestCanonicalizes(t *testing.T) {
	want := valueHash("sk_live_51HxAbCdEfGh123456")
	for _, v := range []string{`"sk_live_51HxAbCdEfGh123456"`, "'sk_live_51HxAbCdEfGh123456'", " sk_live_51HxAbCdEfGh123456 ", "`sk_live_51HxAbCdEfGh123456`", "sk_live_51HxAbCdEfGh123456.", "SK_LIVE_51HXABCDEFGH123456"} {
		if valueHash(v) != want {
			t.Errorf("%q is a different digest", v)
		}
	}
	if valueHash("sk_live_51HxAbCdEfGh123457") == want {
		t.Error("a near miss must stay a different value")
	}
}

// Documented example values are not secrets, wherever they appear.
func TestSecretValuesSkipsDocumentedExamples(t *testing.T) {
	out := `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
API_KEY=your_api_key_here
STRIPE_KEY=sk_test_sample1234567890abc
TOKEN=<your-token-here>
SECRET=xxxxxxxxxxxxxxxx
PASSWORD=changeme123
DATABASE_URL=postgres://app:s3cretpass@db.example.com/app
GITHUB_TOKEN=ghp_abcdefghijklmnop1234`
	got := map[string]bool{}
	for _, v := range secretValues(out) {
		got[v] = true
	}
	for _, v := range []string{"AKIAIOSFODNN7EXAMPLE", "your_api_key_here", "sk_test_sample1234567890abc", "xxxxxxxxxxxxxxxx", "changeme123"} {
		if got[v] {
			t.Errorf("%q is a documented example, not a secret", v)
		}
	}
	for _, v := range []string{"postgres://app:s3cretpass@db.example.com/app", "ghp_abcdefghijklmnop1234"} {
		if !got[v] {
			t.Errorf("%q is a real secret and must still be found", v)
		}
	}
}
