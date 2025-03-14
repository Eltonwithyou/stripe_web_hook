require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Client, Databases,Query } = require('node-appwrite');
const bodyParser = require('body-parser');

// Initialize Express app
const app = express();

// Configure Appwrite client
const appwriteClient = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(appwriteClient);

// Use raw body for Stripe webhook signature verification
app.use('/webhook', bodyParser.raw({ type: 'application/json' }));
// Use JSON parser for other routes
app.use(express.json());

// Stripe webhook handler
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify the webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log(`Webhook received: ${event.type}`);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle specific events
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        console.log('Payment Intent Succeeded Response:', JSON.stringify(event.data.object, null, 2));
         await handlePaymentIntentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        console.log('Payment Intent Failed Response:', JSON.stringify(event.data.object, null, 2));
        // await handlePaymentIntentFailed(event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Return a 200 response to acknowledge receipt of the event
    res.status(200).json({ received: true });
  } catch (error) {
    console.error(`Error processing webhook: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle successful payment
async function handlePaymentIntentSucceeded(paymentIntent) {
  console.log(`PaymentIntent succeeded: ${paymentIntent.id}`);
  
  try {
    // Find the payment record in Appwrite by payment intent ID
    const paymentRecords = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_COLLECTION_ID,
      [Query.equal("paymentId",paymentIntent.id)]
    );

    if (paymentRecords.documents.length > 0) {
      const paymentDoc = paymentRecords.documents[0];
      
      // Update the payment status in Appwrite
      await databases.updateDocument(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_COLLECTION_ID,
        paymentDoc.$id,
        {
          paymentStatus: 'paid',
          paymentMethod: paymentIntent.payment_method_types[0],
          // Add any other fields you want to update
        }
      );
      
      console.log(`Updated payment record ${paymentDoc.$id} to succeeded status`);
    } else {
      console.log(`No payment record found for PaymentIntent: ${paymentIntent.id}`);
      // Optionally create a new record if none exists
    //   await databases.createDocument(
    //     process.env.APPWRITE_DATABASE_ID,
    //     process.env.APPWRITE_COLLECTION_ID,
    //     'unique()',
    //     {
    //       paymentIntentId: paymentIntent.id,
    //       status: 'succeeded',
    //       createdAt: new Date().toISOString(),
    //       updatedAt: new Date().toISOString(),
    //       amount: paymentIntent.amount,
    //       currency: paymentIntent.currency,
    //       paymentMethod: paymentIntent.payment_method_types[0],
    //       // Add any other fields you want to include
    //     }
    //   );
      console.log(`Created new payment record for PaymentIntent: ${paymentIntent.id}`);
    }
  } catch (error) {
    console.error(`Error updating Appwrite database: ${error.message}`);
    throw error;
  }
}

// Handle failed payment
async function handlePaymentIntentFailed(paymentIntent) {
  console.log(`PaymentIntent failed: ${paymentIntent.id}`);
  
  try {
    // Find the payment record in Appwrite by payment intent ID
    const paymentRecords = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_COLLECTION_ID,
      [
        // Query to find the document with matching payment intent ID
        { field: 'paymentIntentId', operator: 'equal', value: paymentIntent.id }
      ]
    );

    if (paymentRecords.documents.length > 0) {
      const paymentDoc = paymentRecords.documents[0];
      
      // Update the payment status in Appwrite
      await databases.updateDocument(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_COLLECTION_ID,
        paymentDoc.$id,
        {
          status: 'failed',
          updatedAt: new Date().toISOString(),
          errorMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
          // Add any other fields you want to update
        }
      );
      
      console.log(`Updated payment record ${paymentDoc.$id} to failed status`);
    } else {
      console.log(`No payment record found for PaymentIntent: ${paymentIntent.id}`);
      // Optionally create a new record if none exists
      await databases.createDocument(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_COLLECTION_ID,
        'unique()',
        {
          paymentIntentId: paymentIntent.id,
          status: 'failed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          errorMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
          // Add any other fields you want to include
        }
      );
      console.log(`Created new payment record for PaymentIntent: ${paymentIntent.id}`);
    }
  } catch (error) {
    console.error(`Error updating Appwrite database: ${error.message}`);
    throw error;
  }
}

// Start the server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
});