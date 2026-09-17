UUID := opencode-go-usage@iamohd
EXTENSION_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
PACKAGE_DIR := build/$(UUID)
PACKAGE_ZIP := dist/$(UUID).shell-extension.zip

.PHONY: all test check install uninstall package clean

all: test check package

test:
	@echo "==> Running tests"
	gjs -m tests/run.js

check:
	@echo "==> Running unit tests"
	gjs -m tests/run.js
	@echo "==> Import smoke test (GI-backed modules)"
	gjs -m tests/imports.js
	@echo "==> Checking shell-module syntax"
	@set -e; for f in extension.js prefs.js lib/notifications.js; do \
		echo "    $$f"; \
		node --experimental-default-type=module --check "$$f"; \
	done
	@echo "==> Validating GSettings schema"
	glib-compile-schemas --strict schemas/
	@echo "==> OK"

install: check
	@echo "==> Installing to $(EXTENSION_DIR)"
	rm -rf $(EXTENSION_DIR)
	mkdir -p $(EXTENSION_DIR)
	cp -r extension.js prefs.js stylesheet.css metadata.json lib schemas $(EXTENSION_DIR)/
	glib-compile-schemas $(EXTENSION_DIR)/schemas/
	@echo "Installed. Restart GNOME Shell (X11: Alt+F2 -> r) or log out/in (Wayland),"
	@echo "then enable with:"
	@echo "    gnome-extensions enable $(UUID)"

uninstall:
	@echo "==> Removing $(EXTENSION_DIR)"
	rm -rf $(EXTENSION_DIR)

package: check
	@echo "==> Building $(PACKAGE_ZIP)"
	rm -rf build dist
	mkdir -p $(PACKAGE_DIR) dist
	cp -r extension.js prefs.js stylesheet.css metadata.json lib schemas $(PACKAGE_DIR)/
	glib-compile-schemas $(PACKAGE_DIR)/schemas/
	cd $(PACKAGE_DIR) && zip -qr ../$(UUID).shell-extension.zip .
	mv build/$(UUID).shell-extension.zip dist/
	rm -rf build
	@echo "Package ready: $(PACKAGE_ZIP)"

clean:
	rm -rf build dist