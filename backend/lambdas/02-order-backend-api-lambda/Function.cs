using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.SQS;
using Amazon.SQS.Model;
using Residencia.Foundation.Orders.Data;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace Residencia.Foundation.Orders;

public sealed class Function
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ICommerceRepository _repository;
    private readonly IAmazonSQS _sqs;
    private readonly string _queueUrl;

    public Function()
        : this(
            RepositoryFactory.Create(),
            new AmazonSQSClient(),
            Environment.GetEnvironmentVariable("ORDER_QUEUE_URL")
            ?? throw new InvalidOperationException("ORDER_QUEUE_URL is required.")
        )
    {
    }

    internal Function(ICommerceRepository repository, IAmazonSQS sqs, string queueUrl)
    {
        _repository = repository;
        _sqs = sqs;
        _queueUrl = queueUrl;
    }

    public async Task<APIGatewayProxyResponse> FunctionHandler(
        APIGatewayProxyRequest request,
        ILambdaContext context
    )
    {
        var correlationId = request.RequestContext?.RequestId ?? context.AwsRequestId;
        APIGatewayProxyResponse response;

        try
        {
            var method = request.HttpMethod;
            var path = request.Path;
            var claims = request.RequestContext?.Authorizer?.Claims
                         ?? new Dictionary<string, string>();

            Log(context, "info", "order-request-received", correlationId, new { method, path });

            response = (method, path) switch
            {
                ("POST", "/orders") => await CreateOrder(request, claims, context, correlationId),
                ("GET", "/orders") => await ListBuyerOrders(claims),
                ("GET", "/seller/orders") => await ListSellerOrders(claims),
                _ => Json(404, new { message = "Route not found." }),
            };
        }
        catch (Exception exception)
        {
            Log(context, "error", "order-request-failed", correlationId, new
            {
                exception.Message,
                exception.StackTrace
            });
            response = Json(500, new { message = "Internal server error." });
        }

        response.Headers["x-correlation-id"] = correlationId;
        response.Headers["access-control-expose-headers"] = "x-correlation-id";

        Log(context, "info", "order-request-completed", correlationId, new
        {
            statusCode = response.StatusCode
        });

        return response;
    }

    private async Task<APIGatewayProxyResponse> CreateOrder(
        APIGatewayProxyRequest request,
        IDictionary<string, string> claims,
        ILambdaContext context,
        string correlationId
    )
    {
        var input = JsonSerializer.Deserialize<CreateOrderRequest>(request.Body ?? "{}", JsonOptions);
        if (input is null || string.IsNullOrWhiteSpace(input.ProductId) || input.Quantity <= 0)
            return Json(400, new { message = "productId and a positive quantity are required." });

        var product = await _repository.FindProduct(input.ProductId);
        if (product is null) return Json(404, new { message = "Product not found." });
        if (product.Stock < input.Quantity) return Json(409, new { message = "Insufficient stock." });

        var orderId = Guid.NewGuid().ToString();
        var createdAt = DateTimeOffset.UtcNow;
        var buyerId = RequiredClaim(claims, "sub");
        var buyerEmail = OptionalClaim(claims, "email");
        var buyerName = OptionalClaim(claims, "name")
                        ?? OptionalClaim(claims, "given_name")
                        ?? NameFromEmail(buyerEmail);
        var orderEvent = new OrderCreatedEvent(
            orderId,
            buyerId,
            product.SellerId,
            product.Id,
            input.Quantity,
            createdAt,
            orderId,
            buyerName,
            buyerEmail
        );
        var pendingOrder = new SellerOrder(
            orderEvent.OrderId,
            orderEvent.BuyerId,
            orderEvent.SellerId,
            orderEvent.ProductId,
            orderEvent.Quantity,
            "pending",
            createdAt,
            buyerName,
            buyerEmail
        );

        await _repository.CreatePendingOrder(pendingOrder, orderEvent.IdempotencyKey);

        await _sqs.SendMessageAsync(new SendMessageRequest
        {
            QueueUrl = _queueUrl,
            MessageBody = JsonSerializer.Serialize(orderEvent, JsonOptions),
            MessageAttributes = new Dictionary<string, MessageAttributeValue>
            {
                ["correlationId"] = new()
                {
                    DataType = "String",
                    StringValue = correlationId,
                },
            },
        });

        Log(context, "info", "order-enqueued", correlationId, new { orderId, buyerId });

        return Json(202, new { orderId, status = "pending", order = pendingOrder });
    }

    private async Task<APIGatewayProxyResponse> ListSellerOrders(
        IDictionary<string, string> claims
    )
    {
        var orders = await _repository.ListSellerOrders(RequiredClaim(claims, "sub"));
        return Json(200, new { items = orders });
    }

    private async Task<APIGatewayProxyResponse> ListBuyerOrders(
        IDictionary<string, string> claims
    )
    {
        var orders = await _repository.ListBuyerOrders(RequiredClaim(claims, "sub"));
        return Json(200, new { items = orders });
    }

    private static string RequiredClaim(IDictionary<string, string> claims, string name) =>
        claims.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidOperationException($"JWT claim {name} is required.");

    private static string? OptionalClaim(IDictionary<string, string> claims, string name) =>
        claims.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.Trim()
            : null;

    private static string? NameFromEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var localPart = email.Split('@', 2)[0];
        return string.Join(
            " ",
            localPart.Split(['.', '_', '-'], StringSplitOptions.RemoveEmptyEntries)
                .Select(part => char.ToUpperInvariant(part[0]) + part[1..])
        );
    }

    private static APIGatewayProxyResponse Json(int statusCode, object body, string? correlationId = null)
    {
        var headers = new Dictionary<string, string>
        {
            ["content-type"] = "application/json",
            ["access-control-allow-origin"] = Environment.GetEnvironmentVariable("ALLOWED_ORIGIN") ?? "*",
            ["access-control-allow-headers"] = "Content-Type,Authorization",
            ["access-control-allow-methods"] = "GET,POST,PUT,DELETE,OPTIONS",
        };
        if (correlationId is not null) headers["x-correlation-id"] = correlationId;

        return new APIGatewayProxyResponse
        {
            StatusCode = statusCode,
            Headers = headers,
            Body = JsonSerializer.Serialize(body, JsonOptions),
        };
    }

    private static void Log(
        ILambdaContext context,
        string level,
        string message,
        string correlationId,
        object? data = null
    ) =>
        context.Logger.LogLine(JsonSerializer.Serialize(new
        {
            level,
            message,
            correlationId,
            data,
            timestamp = DateTimeOffset.UtcNow,
        }, JsonOptions));
}