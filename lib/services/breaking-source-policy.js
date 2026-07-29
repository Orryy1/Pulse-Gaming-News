"use strict";

/*
 * Checked-in source classification is deliberately narrow. A host being
 * listed here permits evidence capture, not publication. First-party
 * confirmation still requires extracted body evidence and editorial
 * confirmation still requires two distinct configured outlets.
 */
const BREAKING_SOURCE_POLICY = Object.freeze({
  official_first_party: Object.freeze([
    Object.freeze({
      source_id: "xbox-wire",
      owner: "Microsoft Gaming",
      hosts: Object.freeze(["news.xbox.com"]),
      subject_ids: Object.freeze(["xbox", "microsoft-gaming"]),
    }),
    Object.freeze({
      source_id: "playstation-blog",
      owner: "Sony Interactive Entertainment",
      hosts: Object.freeze(["blog.playstation.com"]),
      subject_ids: Object.freeze(["playstation", "sony"]),
    }),
    Object.freeze({
      source_id: "nintendo-news",
      owner: "Nintendo",
      hosts: Object.freeze(["nintendo.com"]),
      subject_ids: Object.freeze(["nintendo"]),
    }),
    Object.freeze({
      source_id: "steam-news",
      owner: "Valve",
      hosts: Object.freeze([
        "store.steampowered.com",
        "api.steampowered.com",
      ]),
      subject_ids: Object.freeze(["steam", "valve"]),
    }),
    Object.freeze({
      source_id: "ea-news",
      owner: "Electronic Arts",
      hosts: Object.freeze(["ea.com"]),
      subject_ids: Object.freeze(["ea", "electronic-arts"]),
    }),
    Object.freeze({
      source_id: "ubisoft-news",
      owner: "Ubisoft",
      hosts: Object.freeze(["ubisoft.com"]),
      subject_ids: Object.freeze(["ubisoft"]),
    }),
    Object.freeze({
      source_id: "bethesda-news",
      owner: "Bethesda",
      hosts: Object.freeze(["bethesda.net"]),
      subject_ids: Object.freeze(["bethesda"]),
    }),
  ]),
  trusted_editorial: Object.freeze([
    Object.freeze({
      source_id: "ign",
      outlet: "IGN",
      hosts: Object.freeze(["ign.com"]),
    }),
    Object.freeze({
      source_id: "gamespot",
      outlet: "GameSpot",
      hosts: Object.freeze(["gamespot.com"]),
    }),
    Object.freeze({
      source_id: "eurogamer",
      outlet: "Eurogamer",
      hosts: Object.freeze(["eurogamer.net"]),
    }),
    Object.freeze({
      source_id: "vGC",
      outlet: "Video Games Chronicle",
      hosts: Object.freeze(["videogameschronicle.com"]),
    }),
    Object.freeze({
      source_id: "gematsu",
      outlet: "Gematsu",
      hosts: Object.freeze(["gematsu.com"]),
    }),
    Object.freeze({
      source_id: "the-verge",
      outlet: "The Verge",
      hosts: Object.freeze(["theverge.com"]),
    }),
  ]),
});

module.exports = {
  BREAKING_SOURCE_POLICY,
};
