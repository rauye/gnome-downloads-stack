UUID := downloads-stack@rauye.github.io
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(UUID).shell-extension.zip

.PHONY: pack install uninstall clean

pack:
	mkdir -p $(DIST_DIR)
	gnome-extensions pack --force --out-dir=$(DIST_DIR) \
		--extra-source=downloads-stack.js \
		--extra-source=LICENSE .

install: pack
	gnome-extensions install --force $(PACKAGE)

uninstall:
	gnome-extensions disable $(UUID) 2>/dev/null || true
	gnome-extensions uninstall $(UUID)

clean:
	rm -rf $(DIST_DIR)
