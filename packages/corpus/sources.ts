// Seed corpus for Coins (E8). Tier-1 API snapshots (PCGS, Numista) can close a
// check; Tier-2 archives (NNP, acsearch die-match) corroborate. In production the
// Cron batch fetches and refreshes these; here they are static seeds so retrieval
// is testable offline.

import type { Category, SourceTier } from "@/packages/pcs-types";

export interface CorpusSourceDoc {
  category: Category;
  source: string;
  tier: SourceTier;
  url?: string;
  licence?: string;
  text: string;
}

export const COIN_CORPUS: CorpusSourceDoc[] = [
  {
    category: "coins",
    source: "PCGS CoinFacts",
    tier: 1,
    url: "https://www.pcgs.com/coinfacts",
    text: "2007 Canada Proof Set, Royal Canadian Mint (RCM). Denomination proof set, mint mark RCM, year 2007. Proof finish, cameo devices. PCGS CoinFacts entry with population report and auction price record.",
  },
  {
    category: "coins",
    source: "Numista",
    tier: 1,
    url: "https://en.numista.com",
    text: "Numista catalogue entry: Canada 2007 proof set issued by the Royal Canadian Mint. Country Canada, denomination proof set, year 2007, mint mark RCM, variety proof. Image identification supported.",
  },
  {
    category: "coins",
    source: "acsearch.info (die-match)",
    tier: 2,
    url: "https://www.acsearch.info",
    text: "acsearch die-match reference: 2007 RCM proof set, sealed state, comparable examples sold at Heritage. Die characteristics and strike consistent with Royal Canadian Mint 2007 proof issue.",
  },
  {
    category: "coins",
    source: "Newman Numismatic Portal",
    tier: 2,
    url: "https://nnp.wustl.edu",
    text: "Newman Numismatic Portal catalogue: Royal Canadian Mint proof sets 2005-2010. 2007 proof set specifications, packaging, and certificate of authenticity notes.",
  },
];
