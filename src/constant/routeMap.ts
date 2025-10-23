export enum ApiRoute {
  AUTO_FAUCET_DRIP = "/api/autofaucet/drip",
  FAUCET_CHECK_EVM = "/api/faucet/check-EVM",
  FAUCET_CHECK_HEDERA = "/api/faucet/check-hedera",
  FAUCET_CLAIM = "/api/faucet/faucet-claim",
  PASSPORT_SCORE = "/api/passport/score",
  AUTO_FAUCET_FINALIZE = "/api/autofaucet/finalize",
  FAUCET_TRANSACTIONS = "/api/transactions",
  FAUCET_ACCOUNT_TRANSACTIONS = "/api/transactions/account"
}

export enum ApiScope {
  AUTO_FAUCET_DRIP = "autofaucet:drip",
  FAUCET_CHECK_EVM = "faucet:check-EVM",
  FAUCET_CHECK_HEDERA = "faucet:check-hedera",
  FAUCET_CLAIM = "faucet:drip",
  PASSPORT_SCORE = "passport:score",
  //AUTO_FAUCET_FINALIZE = "autofaucet:finalize"
  FAUCET_TRANSACTIONS = "faucet:transactions"
}

export interface RouteConfig {
  path: ApiRoute;
  scope: string;
  cost: number;
}

const AUTOFAUCET_ROUTES: RouteConfig[] = [
  { path: ApiRoute.AUTO_FAUCET_DRIP, scope: ApiScope.AUTO_FAUCET_DRIP, cost: 1 },
  { path: ApiRoute.AUTO_FAUCET_FINALIZE, scope: ApiScope.AUTO_FAUCET_DRIP, cost: 0},
];

const FAUCET_ROUTES: RouteConfig[] = [
  { path: ApiRoute.FAUCET_CHECK_EVM, scope: ApiScope.FAUCET_CHECK_EVM, cost: 1 },
  { path: ApiRoute.FAUCET_CHECK_HEDERA, scope: ApiScope.FAUCET_CHECK_HEDERA, cost: 1 },
  { path: ApiRoute.FAUCET_CLAIM, scope: ApiScope.FAUCET_CLAIM, cost: 1 },
];

const TRANSACTION_ROUTES: RouteConfig[] = [
  { path: ApiRoute.FAUCET_TRANSACTIONS, scope: ApiScope.FAUCET_TRANSACTIONS, cost: 1},
  { path: ApiRoute.FAUCET_ACCOUNT_TRANSACTIONS, scope: ApiScope.FAUCET_TRANSACTIONS, cost: 1}
];

const PASSPORT_ROUTES: RouteConfig[] = [
  { path: ApiRoute.PASSPORT_SCORE, scope: ApiScope.PASSPORT_SCORE, cost: 1 },
];

export const ROUTES: RouteConfig[] = [
  ...AUTOFAUCET_ROUTES,
  ...FAUCET_ROUTES,
  ...PASSPORT_ROUTES,
  ...TRANSACTION_ROUTES,
];

export const ROUTE_CONFIG = Object.fromEntries(
  ROUTES.map((r) => [r.path, r])
)


/* 
    Example of tiers 


    const TIERS: {
  name: Tier;
  requestLimit: number;
  features: string[];
    }[] = [
    {
        name: "BASIC" as Tier,
        requestLimit: 200,
        features: ["faucet:claim"], 
    },
    {
        name: "ADVANCED" as Tier,
        requestLimit: 5000,
        features: ["faucet:claim", "passport:read"],
    },
    {
        name: "ENTERPRISE" as Tier,
        requestLimit: 10000,
        features: ["faucet:claim", "passport:read"],
    },
];

*/


/* 
Side note not now, if time permits put scopes, api routes, cost into DB easier to change and scale and with an internal portal we can add/remove or even create custom scopes/better tier customization. 
*/