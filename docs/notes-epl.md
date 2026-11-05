# Note: the EPL wording in the build plan (the first-round text) and in this repository

An earlier build plan of Cresmaia Inc. lists, for elkjs, "EPL section 3 (b)(i) to (iii)": a disclaimer of
warranties and conditions, an exclusion of liability, and a statement that different terms are offered by the distributor alone. Those items are
the wording of **EPL-1.0**, where section 3 sets the conditions of a commercial or any distribution. In the **EPL-2.0** that this repository places for
elkjs 0.12.0 (`LICENSES/EPL-2.0-elkjs-0.12.0-LICENSE.md`), the conditions are:

- section 3.1(a): the Program must also be made available as Source Code, with a statement that the Source Code is available under the EPL and
  how to obtain it. This is the condition that applies when elkjs is distributed under the EPL-2.0.
- section 3.1(b): a Contributor may distribute the Program under a **different** license, if that license (i) to (iv) disclaims warranties on behalf of
  all other Contributors, excludes liability, does not limit the recipients' rights in the Source Code, and requires subsequent distributions to be under
  a license that satisfies section 3. It applies only to a distribution under a different license, so it does not apply here.
- sections 5 and 6: the disclaimer of warranty and of liability, which apply to the Program as distributed.
- section 4: commercial distribution (indemnification); a decision of the representative (W7), not a NOTICE text.

The item "EPL section 3 and 4: write the disclaimer of warranty in NOTICE" of that plan is therefore read as the notice of sections 5 and 6
and of "no warranty by Cresmaia Inc." in `NOTICE` section 3.7.1 (from release 0.1.0-pre.3).

## The EPL-1.0 wording does apply to the EMF classes inside elkjs (release 0.1.0-pre.3)

The file `elkjs/lib/elk.bundled.js` also contains classes of the Eclipse Modeling Framework (emf-gwt 2.12.4), which are under the **EPL-1.0**, not the EPL-2.0 (`records/p7/classes.tsv`, part K5; `NOTICE` section 3.7.2). For them, Section 3 of the EPL-1.0
is the section that applies when the Program is distributed in object code form, and `NOTICE` section 3.7.2 states its four items (i) to (iv). The statement for elkjs itself (EPL-2.0) is still the one above.
Item (iii) ("offered by ... alone") is written about the terms of the whole release (NOTICE and the index pages), not about elkjs.
