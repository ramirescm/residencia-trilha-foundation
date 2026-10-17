import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const API = __ENV.API;
const REGION = __ENV.REGION || "us-east-1";
const CATALOG_VUS = Number(__ENV.CATALOG_VUS || 8);
const ORDER_VUS = Number(__ENV.ORDER_VUS || 2);
const DURATION = __ENV.DURATION || "2m";
const THINK_TIME = Number(__ENV.THINK_TIME || 0.2); // segundos entre requisições

const failures = new Counter("failed_requests");

http.setResponseCallback(http.expectedStatuses(200, 202));

export const options = {
  scenarios: {
    catalog: {
      executor: "constant-vus",
      exec: "browseCatalog",
      vus: CATALOG_VUS,
      duration: DURATION,
    },
    orders: {
      executor: "constant-vus",
      exec: "createOrder",
      vus: ORDER_VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    "http_req_duration{endpoint:catalog}": ["p(95)<800"],
    "http_req_duration{endpoint:orders}": ["p(95)<1200"],
    "http_req_failed{endpoint:catalog}": ["rate<0.01"],
    "http_req_failed{endpoint:orders}": ["rate<0.01"],
  },
};

export function setup() {
  const res = http.post(
    `https://cognito-idp.${REGION}.amazonaws.com/`,
    JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: __ENV.CLIENT_ID,
      AuthParameters: { USERNAME: __ENV.USERNAME, PASSWORD: __ENV.PASSWORD },
    }),
    {
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      responseCallback: http.expectedStatuses(200),
    },
  );
  const token =
    res.status === 200 ? res.json("AuthenticationResult.IdToken") : null;
  if (!token) {
    throw new Error(
      `Cognito login failed: status=${res.status} body=${res.body}`,
    );
  }
  return { token };
}

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

function report(res, ok, label) {
  if (!ok) {
    failures.add(1);
    const cid =
      res.headers["X-Correlation-Id"] || res.headers["x-correlation-id"];
    console.error(
      `${label} status=${res.status} cid=${cid} body=${String(res.body).slice(0, 200)}`,
    );
  }
}

export function browseCatalog(data) {
  const res = http.get(`${API}/products`, {
    headers: headers(data.token),
    tags: { endpoint: "catalog" },
  });
  report(
    res,
    check(res, { "catalog 200": (r) => r.status === 200 }),
    "GET /products",
  );
  sleep(THINK_TIME);
}

export function createOrder(data) {
  const res = http.post(
    `${API}/orders`,
    JSON.stringify({ productId: __ENV.PRODUCT_ID, quantity: 1 }),
    { headers: headers(data.token), tags: { endpoint: "orders" } },
  );
  report(
    res,
    check(res, { "order 202": (r) => r.status === 202 }),
    "POST /orders",
  );
  sleep(THINK_TIME);
}
