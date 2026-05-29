import configparser
from azure.identity import DeviceCodeCredential

config = configparser.ConfigParser()
config.read('MicrosoftGraphTemplate/config.cfg')

client_id = config['azure']['clientId']
tenant_id = config['azure']['tenantId']
scopes    = config['azure']['graphUserScopes'].split(' ')

print(f"client_id: {client_id}")
print(f"tenant_id: {tenant_id}")
print(f"scopes: {scopes}")

credential = DeviceCodeCredential(client_id=client_id, tenant_id=tenant_id)

print("Getting token...")
token = credential.get_token(*scopes)
print(f"Success! Token expires at: {token.expires_on}")