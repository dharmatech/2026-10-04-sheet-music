LILYPOND ?= lilypond
NAME     := clair-de-lune
SCORE    := scores/$(NAME).ly
TAGS     := lilypond/tag-noteheads.ily
# web/ is the whole site (also what GitHub Pages publishes); the build adds web/svg/.
SVGDIR   := web/svg

.PHONY: all svg pdf serve clean

all: svg pdf

# Tagged SVG pages plus a manifest listing them, for web/index.html.
svg: $(SVGDIR)/$(NAME).json

$(SVGDIR)/$(NAME).json: $(SCORE) $(TAGS)
	mkdir -p $(SVGDIR)
	rm -f $(SVGDIR)/$(NAME)*.svg
	$(LILYPOND) --svg -dinclude-settings=$(TAGS) -o $(SVGDIR)/$(NAME) $(SCORE)
	rm -f $(SVGDIR)/$(NAME).midi
	cd $(SVGDIR) && printf '{"pages": [%s]}\n' \
	  "$$(ls $(NAME)*.svg | sort -V | sed 's/.*/"&"/' | paste -sd,)" > $(NAME).json

pdf: build/$(NAME).pdf

build/$(NAME).pdf: $(SCORE)
	mkdir -p build
	$(LILYPOND) -o build/$(NAME) $(SCORE)

# The page fetches the SVGs, which browsers block from file:// URLs.
serve: svg
	@echo "Open http://localhost:8000/"
	python3 -m http.server 8000 --bind 127.0.0.1 --directory web

clean:
	rm -rf build $(SVGDIR)
