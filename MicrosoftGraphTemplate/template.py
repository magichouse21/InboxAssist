#Template for calling Microsoft Graph from Python
import asyncio
import configparser
from msgraph.generated.models.o_data_errors.o_data_error import ODataError
from graph import Graph

async def main():
    # Load settings
    config = configparser.ConfigParser()
    config.read(['config.cfg', 'config.dev.cfg'])
    azure_settings = config['azure']

    graph: Graph = Graph(azure_settings)

    await greet_user(graph)

    choice = -1

    while choice != 0:
        print('Please choose one of the following options:')
        print('0. Exit')
        print('1. List my inbox')
        print('2. Send mail')
        print('3. Filtered Search of my mailbox')

        try:
            choice = int(input())
        except ValueError:
            choice = -1

        try:
            if choice == 0:
                print('Goodbye...')
            elif choice == 1:
                await list_inbox(graph)
            elif choice == 2:
                await send_mail(graph)
            elif choice == 3:
                await filtered_search(graph)
            else:
                print('Invalid choice!\n')
        except ODataError as odata_error:
            print('Error:')
            if odata_error.error:
                print(odata_error.error.code, odata_error.error.message)

async def greet_user(graph: Graph):
    user = await graph.get_user()
    if user:
        print('Hello,', user.display_name)
        # For Work/school accounts, email is in mail property
        # Personal accounts, email is in userPrincipalName
        print('Email:', user.mail or user.user_principal_name, '\n')

async def list_inbox(graph: Graph):
    message_page = await graph.get_inbox()
    if message_page and message_page.value:
        # Output each message's details
        for message in message_page.value:
            print('Message:', message.subject)
            if (
                message.from_ and
                message.from_.email_address
            ):
                print('  From:', message.from_.email_address.name or 'NONE')
            else:
                print('  From: NONE')
            print('  Status:', 'Read' if message.is_read else 'Unread')
            print('  Received:', message.received_date_time)
            print('  Importance:', message.importance)
            print('  Body:', message.body.content if message.body else 'NONE')

        more_available = message_page.odata_next_link is not None
        print('\nMore messages available?', more_available, '\n')

async def send_mail(graph: Graph):
    # Send mail to the signed-in user
    # Get the user for their email address
    reciepient = input('Enter the email address of the recipient: ')
    subject = input('Enter the subject of the email: ')
    body = input('Enter the body of the email: ')
    user = await graph.get_user()
    if user:
        await graph.send_mail(subject, body, reciepient)
        print('Mail sent.\n')

async def filtered_search(graph: Graph):
    keyword = input('Enter a keyword to search your Outlook mailbox: ')

    messages = await graph.search_messages(keyword)

    if messages and messages.value:
        for message in messages.value:
            print('Message:', message.subject)

            if message.from_ and message.from_.email_address:
                print('  From:', message.from_.email_address.name or 'NONE')
            else:
                print('  From: NONE')

            print('  Status:', 'Read' if message.is_read else 'Unread')
            print('  Received:', message.received_date_time)
            print('  Importance:', message.importance)
            print('  Body:', message.body.content if message.body else 'NONE')
            print()
    else:
        print('No matching messages found.\n')

asyncio.run(main())
