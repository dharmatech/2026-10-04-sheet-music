%% tag-noteheads.ily
%%
%% Writes data-* attributes onto every NoteHead (and StaffSymbol) in
%% LilyPond's SVG output, so a web page can work out which notes start,
%% or are still held, at each moment.
%%
%% Loaded without touching the score:
%%   lilypond --svg -dinclude-settings=lilypond/tag-noteheads.ily score.ly
%%
%% NoteHead attributes:
%%   id              unique "n<k>"
%%   class           "note"
%%   data-onset      moment the note starts, in whole notes, e.g. "27/8"
%%   data-grace      grace part of that moment (only on grace notes), e.g. "-1/16"
%%   data-dur        written length in whole notes, tuplet scaling included
%%   data-step       letter name C..B
%%   data-alter      alteration in semitones (-2 = double flat, -1 = flat, 1 = sharp)
%%   data-key-alter  alteration the key signature gives this letter, same units
%%   data-oct        octave number (scientific: middle C = C4)
%%   data-midi       MIDI key number (sounding pitch)
%%   data-ottava     octave shift in effect (only under \ottava), e.g. "1" for 8va
%%   data-bar        bar number
%%   data-pos        position inside the bar, in whole notes
%%   data-time       time signature, e.g. "9/8"
%%   data-voice      id of the Voice context the note came from
%%   data-staff      id of the Staff the note is printed on (after \change Staff)
%%   data-sys        key of the system (line of music) the note landed on
%%   data-tied       "1" if this head is the right end of a tie (held, not struck)
%%   data-hidden     "1" if hidden with \hideNotes (a placeholder, not a real note)
%%   data-merged     "1" if LilyPond merged this head into another voice's
%%                   identical head and left it invisible (still a real note)
%%   data-src        source line:column of the note
%%
%% StaffSymbol attributes (one per staff per system):
%%   class "staff", data-staff, data-sys

\version "2.24.0"

#(define (tag:num x) (number->string x))

#(define (tag:moment->string m) (tag:num (ly:moment-main m)))

%% A system is identified by the moment at which it starts.
#(define (tag:system-key grob)
   (let ((sys (ly:grob-system grob)))
     (if (ly:grob? sys)
         (tag:moment->string
          (ly:grob-property (ly:spanner-bound sys LEFT) 'when))
         "")))

%% Alteration (in whole tones) that keyAlterations gives this pitch's letter.
%% Entries are either (notename . alter) or ((octave . notename) . alter).
#(define (tag:key-alteration key-alts pitch)
   (let ((n (ly:pitch-notename pitch))
         (o (ly:pitch-octave pitch)))
     (let loop ((alts key-alts))
       (cond ((null? alts) 0)
             ((equal? (caar alts) (cons o n)) (cdar alts))
             ((eqv? (caar alts) n) (cdar alts))
             (else (loop (cdr alts)))))))

%% Right-hand noteheads of ties, filled in when the score finishes.
#(define tag:tied-heads (make-weak-key-hash-table 1024))

#(define (tag-noteheads-engraver context)
   (let ((count 0)
         (ties '()))
     (make-engraver
      (acknowledgers
       ((note-head-interface engraver grob source-engraver)
        (let ((ev (event-cause grob)))
          (if (and (ly:stream-event? ev)
                   (ly:pitch? (ly:event-property ev 'pitch #f)))
              (let* ((voice (ly:translator-context source-engraver))
                     (staff (ly:context-find voice 'Staff))
                     (now (ly:context-current-moment context))
                     (grace (ly:moment-grace now))
                     (pitch (ly:event-property ev 'pitch))
                     (dur (ly:event-property ev 'duration))
                     (c-offset (ly:context-property staff 'middleCOffset 0))
                     (key-alts (ly:context-property staff 'keyAlterations '()))
                     (time-sig (ly:context-property context 'timeSignatureFraction '(4 . 4)))
                     ;; \hideNotes sets this up front; note merging sets it later.
                     (hidden (eq? #t (ly:grob-property grob 'transparent #f)))
                     (origin (ly:input-file-line-char-column
                              (ly:event-property ev 'origin)))
                     (base
                      (append
                       (list
                        (cons 'id (format #f "n~a" (begin (set! count (1+ count)) count)))
                        (cons 'class "note")
                        (cons 'data-onset (tag:moment->string now)))
                       (if (zero? grace) '() (list (cons 'data-grace (tag:num grace))))
                       (list
                        (cons 'data-dur (tag:moment->string (ly:duration-length dur)))
                        (cons 'data-step (string (string-ref "CDEFGAB" (ly:pitch-notename pitch))))
                        (cons 'data-alter (tag:num (* 2 (ly:pitch-alteration pitch))))
                        (cons 'data-key-alter (tag:num (* 2 (tag:key-alteration key-alts pitch))))
                        (cons 'data-oct (tag:num (+ 4 (ly:pitch-octave pitch))))
                        (cons 'data-midi (tag:num (+ 60 (ly:pitch-semitones pitch)))))
                       (if (zero? c-offset) '()
                           (list (cons 'data-ottava (tag:num (/ c-offset -7)))))
                       (list
                        (cons 'data-bar (tag:num (ly:context-property context 'currentBarNumber)))
                        (cons 'data-pos (tag:moment->string (ly:context-property context 'measurePosition)))
                        (cons 'data-time (format #f "~a/~a" (car time-sig) (cdr time-sig)))
                        (cons 'data-voice (ly:context-id voice))
                        (cons 'data-staff (ly:context-id staff))
                        (cons 'data-src (format #f "~a:~a" (cadr origin) (cadddr origin))))
                       (if hidden '((data-hidden . 1)) '()))))
                ;; Evaluated at output time, after line breaking and after
                ;; every tie is known.
                (ly:grob-set-property!
                 grob 'output-attributes
                 (lambda (g)
                   (append base
                           (list (cons 'data-sys (tag:system-key g)))
                           (if (hashq-ref tag:tied-heads g #f) '((data-tied . 1)) '())
                           (if (and (not hidden)
                                    (eq? #t (ly:grob-property g 'transparent #f)))
                               '((data-merged . 1)) '()))))))))
       ((tie-interface engraver grob source-engraver)
        (set! ties (cons grob ties)))
       ((staff-symbol-interface engraver grob source-engraver)
        (let ((staff-id (ly:context-id (ly:translator-context source-engraver))))
          (ly:grob-set-property!
           grob 'output-attributes
           (lambda (g)
             (list (cons 'class "staff")
                   (cons 'data-staff staff-id)
                   (cons 'data-sys (tag:system-key g))))))))
      ((finalize engraver)
       (for-each
        (lambda (tie)
          (let ((head (ly:spanner-bound tie RIGHT)))
            (if (and (ly:grob? head)
                     (grob::has-interface head 'note-head-interface))
                (hashq-set! tag:tied-heads head #t))))
        ties)))))

\layout {
  \context {
    \Score
    \consists #tag-noteheads-engraver
  }
}
