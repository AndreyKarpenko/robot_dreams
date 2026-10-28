import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ALLOWED_CONTENT_TYPES,
  type AllowedContentType,
} from '../../storage/content-types';
import { MAX_OBJECT_BYTES } from '../../storage/limits';

export class IntentDto {
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: AllowedContentType;

  @IsInt()
  @Min(1)
  @Max(MAX_OBJECT_BYTES)
  size: number;

  /**
   * Accepted so a client may send it, then discarded. The object key is
   * generated here; a client filename must not become a path in the bucket.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  filename?: string;
}
