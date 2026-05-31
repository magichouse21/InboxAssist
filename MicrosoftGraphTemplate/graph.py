from configparser import SectionProxy
from azure.identity import DeviceCodeCredential
from msgraph import GraphServiceClient
from msgraph.generated.users.item.user_item_request_builder import UserItemRequestBuilder
from msgraph.generated.users.item.mail_folders.item.messages.messages_request_builder import (
    MessagesRequestBuilder)
from msgraph.generated.users.item.send_mail.send_mail_post_request_body import (
    SendMailPostRequestBody)
from msgraph.generated.models.message import Message
from msgraph.generated.models.item_body import ItemBody
from msgraph.generated.models.body_type import BodyType
from msgraph.generated.models.recipient import Recipient
from msgraph.generated.models.email_address import EmailAddress
from datetime import timedelta
from dateutil import parser


class Graph:
    settings: SectionProxy
    device_code_credential: DeviceCodeCredential
    user_client: GraphServiceClient

    def __init__(self, config: SectionProxy):
        self.settings = config
        client_id = self.settings['clientId']
        tenant_id = self.settings['tenantId']
        graph_scopes = self.settings['graphUserScopes'].split(' ')

        self.device_code_credential = DeviceCodeCredential(client_id=client_id, tenant_id=tenant_id)
        self.user_client = GraphServiceClient(self.device_code_credential, graph_scopes)

    async def get_user_token(self):
        graph_scopes = self.settings['graphUserScopes']
        access_token = self.device_code_credential.get_token(graph_scopes)
        return access_token.token

    async def get_user(self):
        # Only request specific properties using $select
        query_params = UserItemRequestBuilder.UserItemRequestBuilderGetQueryParameters(
            select=['displayName', 'mail', 'userPrincipalName']
        )

        request_config = UserItemRequestBuilder.UserItemRequestBuilderGetRequestConfiguration(
            query_parameters=query_params
        )

        user = await self.user_client.me.get(request_configuration=request_config)
        return user
    
    async def get_inbox(self):
        query_params = MessagesRequestBuilder.MessagesRequestBuilderGetQueryParameters(
            # Only request specific properties
            select=['from', 'subject', 'toRecipients', 'receivedDateTime', 'importance', 'bodyPreview', 'webLink'],
            # Get at most 10 results
            top=25,
            # Sort by received time, newest first
            orderby=['receivedDateTime DESC']
        )
        request_config = MessagesRequestBuilder.MessagesRequestBuilderGetRequestConfiguration(
            query_parameters= query_params
        )
        request_config.headers.add("Prefer", 'outlook.body-content-type="text"')
        messages = await self.user_client.me.mail_folders.by_mail_folder_id('inbox').messages.get(
                request_configuration=request_config)
        return messages

    async def send_mail(self, subject: str, body: str, recipient: str):
        message = Message()
        message.subject = subject

        message.body = ItemBody()
        message.body.content_type = BodyType.Text
        message.body.content = body

        to_recipient = Recipient()
        to_recipient.email_address = EmailAddress()
        to_recipient.email_address.address = recipient
        message.to_recipients = []
        message.to_recipients.append(to_recipient)

        request_body = SendMailPostRequestBody()
        request_body.message = message

        await self.user_client.me.send_mail.post(body=request_body)

    async def search_messages(self, keyword: str):
        query_params = MessagesRequestBuilder.MessagesRequestBuilderGetQueryParameters(
            search=f'"{keyword}"',
            select=['from', 'subject', 'toRecipients', 'receivedDateTime', 'importance', 'body', 'webLink'],
            top=25
        )

        request_config = MessagesRequestBuilder.MessagesRequestBuilderGetRequestConfiguration(
            query_parameters=query_params
        )
        request_config.headers.add("ConsistencyLevel", "eventual")
        request_config.headers.add("Prefer", 'outlook.body-content-type="text"')

        return await self.user_client.me.messages.get(
            request_configuration=request_config
        )
    
    def _message_request_config(self, query_params):
        request_config = MessagesRequestBuilder.MessagesRequestBuilderGetRequestConfiguration(
            query_parameters=query_params
        )
        request_config.headers.add("Prefer", 'outlook.body-content-type="text"')
        return request_config


    async def search_messages_by_date(self, date_str: str):

        target_date = parser.parse(date_str)

        start_of_day = target_date.replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0
        )

        end_of_day = start_of_day + timedelta(days=1)

        filter_query = (
            f"receivedDateTime ge {start_of_day.strftime('%Y-%m-%dT%H:%M:%SZ')} "
            f"and receivedDateTime lt {end_of_day.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        )

        query_params = MessagesRequestBuilder.MessagesRequestBuilderGetQueryParameters(
            filter=filter_query,
            select=['from', 'subject', 'toRecipients', 'receivedDateTime', 'importance', 'body', 'isRead', 'webLink'],
            top=25
        )

        request_config = MessagesRequestBuilder.MessagesRequestBuilderGetRequestConfiguration(
            query_parameters=query_params
        )

        request_config.headers.add(
            "Prefer",
            'outlook.body-content-type="text"'
        )

        messages = await self.user_client.me.messages.get(
            request_configuration=request_config
        )

        if messages and messages.value:
            messages.value.sort(
                key=lambda m: m.received_date_time or "",
                reverse=True
            )

        return messages


    async def search_messages_by_subject(self, subject: str):
        escaped_subject = subject.replace("'", "''")

        query_params = MessagesRequestBuilder.MessagesRequestBuilderGetQueryParameters(
            filter=f"contains(subject, '{escaped_subject}')",
            select=['from', 'subject', 'toRecipients', 'receivedDateTime', 'importance', 'body', 'isRead', 'webLink'],
            top=25
        )
        request_config = MessagesRequestBuilder.MessagesRequestBuilderGetRequestConfiguration(
            query_parameters=query_params
        )
        request_config.headers.add(
            "Prefer",
            'outlook.body-content-type="text"'
        )
        messages = await self.user_client.me.messages.get(
            request_configuration=request_config
        )
        # Sort newest first
        if messages and messages.value:
            messages.value.sort(
                key=lambda m: m.received_date_time or "",
                reverse=True
            )

        return messages


    async def search_messages_by_person(self, person: str):
        query_params = MessagesRequestBuilder.MessagesRequestBuilderGetQueryParameters(
            search=f'"{person}"',
            select=['from', 'subject', 'toRecipients', 'receivedDateTime', 'importance', 'body', 'isRead', 'webLink'],
            top=25
        )

        request_config = MessagesRequestBuilder.MessagesRequestBuilderGetRequestConfiguration(
            query_parameters=query_params
        )

        request_config.headers.add("ConsistencyLevel", "eventual")
        request_config.headers.add("Prefer", 'outlook.body-content-type="text"')

        messages = await self.user_client.me.messages.get(
            request_configuration=request_config
        )

        if messages and messages.value:
            messages.value.sort(
                key=lambda m: m.received_date_time or "",
                reverse=True
            )

        return messages


"""
    'subject',
    'bodyPreview',
    'receivedDateTime',
    'sentDateTime',
    'createdDateTime',
    'lastModifiedDateTime',
    'from',
    'sender',
    'toRecipients',
    'ccRecipients',
    'bccRecipients',
    'replyTo',
    'isRead',
    'isDraft',
    'importance',   
    'flag',
    'hasAttachments',
    'body',           full email body (HTML or text)
    'bodyPreview',
    'id',
    'conversationId',
    'internetMessageId',
    'hasAttachments',
    'attachments',
    'parentFolderId', 

"""
