import {
  ApiBearerAuth as SwaggerApiBearerAuth,
  ApiProperty as SwaggerApiProperty,
  ApiPropertyOptional as SwaggerApiPropertyOptional,
  ApiTags as SwaggerApiTags,
} from '@nestjs/swagger';
import type { ApiPropertyOptions } from '@nestjs/swagger';

export const ApiTags = SwaggerApiTags as (
  ...tags: string[]
) => MethodDecorator & ClassDecorator;

export const ApiBearerAuth = SwaggerApiBearerAuth as (
  name?: string,
) => MethodDecorator & ClassDecorator;

export const ApiProperty = SwaggerApiProperty as (
  options?: ApiPropertyOptions,
) => PropertyDecorator;

export const ApiPropertyOptional = SwaggerApiPropertyOptional as (
  options?: ApiPropertyOptions,
) => PropertyDecorator;
