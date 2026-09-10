export type ZohoCredential = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  apiDomain?: string;
  accountsServer?: string;
  dataCenter?: string;
  tokenType?: string;
  scope?: string;
};

export type ZohoService = "mail" | "cliq" | "crm";

export type ZohoTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  token_type?: string;
  scope?: string;
  api_domain?: string;
  error?: string;
  error_description?: string;
};
