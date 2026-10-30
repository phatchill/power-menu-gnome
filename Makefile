UUID := power-menu@local
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all schemas pack install uninstall clean

all: pack

schemas:
	glib-compile-schemas schemas/

# Build a zip you can install with `gnome-extensions install`
pack: schemas
	gnome-extensions pack --force \
		--extra-source=prefs.js \
		--schema=schemas/org.gnome.shell.extensions.power-menu.gschema.xml .

# Install straight into your extensions folder
install: schemas
	mkdir -p $(DEST)/schemas
	cp metadata.json extension.js prefs.js stylesheet.css $(DEST)/
	cp schemas/*.xml schemas/gschemas.compiled $(DEST)/schemas/
	@echo "Installed. Log out and back in, then: gnome-extensions enable $(UUID)"

uninstall:
	rm -rf $(DEST)

clean:
	rm -f *.zip schemas/gschemas.compiled
